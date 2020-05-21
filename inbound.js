require(Modules.IVR);

// IVR variables
let confId,
    confJID,
    password,
    countInitialPromptPlayed = 0;

/*** Adjust these constants for your installation ***/
const INBOUND_CALL_DURATION_LIMIT = 5 * 60 * 1000;              // Max call duration allowed
const TTS_VOICE = Language.US_ENGLISH_FEMALE;                   // Choose your preferred voice
const VOXIMPLANT_USER = "jigasi";                               // Enter your Voximplant user name here
const MAPPER_URL = "https://api.jitsi.net/conferenceMapper";    // Enter your own URL or use the public Jitsi service
const PROMPTS_NUMBER_HANGUP = 5;                                // # of prompts to be played before dropping the call
const HTTP_REQUEST_TIMEOUT_SEC = 3;                             // How long ot wait before timing out HTTP requests

/**
 * Conference Mapper HTTP request logic
 */

// Check if the specified number is valid conference number
function getConferenceUrl(number) {

    // Handle the HTTP request to get the conference mapping
    function onResponse(res) {
        if (res.code === 200) {
            let result = JSON.parse(res.text);
            if (result.conference) {
                confId = number;
                confJID = result.conference;

                // Move to the next IVR state to check for a password
                confGetPasswordState.enter(userCall);

            } else {
                triggerPlaybackOnInboundCall("unknownConference",
                    "You have specified an unknown conference number.",
                    handleConferenceFailedPlaybackFinished);
            }
        } else {
            Logger.write(`Conference number confirmation call failed for cid: ${number} with status: ${res.code},` +
                `message: ${res.text}, headers ${JSON.stringify(res.headers)}`);
            triggerPlaybackOnInboundCall("lookupError",
                "Something went wrong confirming your conference number, please try again.",
                handleConferenceFailedPlaybackFinished);
        }
    }

    // Helper function for grabbing conferencing info
    let url = MAPPER_URL + "?cid=" + number;
    Net.httpRequest(url, e => {
        if (e.code === 200 || (e.code >= 400 && e.code < 500)) {
            onResponse(e);
        } else {
            Logger.write(`retrying ${url} because of error: ${e.code} -> ${e.error}`);
            // e.code can be <= 8 https://voximplant.com/docs/references/voxengine/net/httprequestresult#code
            // or any of HTTP code (2xx-5xx)
            Net.httpRequest(url, e => {
                if (e.code !== 200) {
                    Logger.write(`httpRequest error after 2nd attempt for ${url}: ${e.code} -> ${e.error}`);
                }
                onResponse(e);
            }, { timeout: HTTP_REQUEST_TIMEOUT_SEC });
        }
    }, { timeout: HTTP_REQUEST_TIMEOUT_SEC });
}

/**
 * IVR Logic
 */

// State that waits for the digit conference number
// if valid conference number was specified it forwards call to this conference
let confNumberState = new IVRState("conferencenumber", {
    type: "inputunknown",
    terminateOn: "#",
    timeout: 10000,
    prompt: {
        say: "Please enter the meeting eye dee and press pound",
        lang: TTS_VOICE
    }
}, data => {
    // Input finished
    let number = data.replace("#", "");
    getConferenceUrl(number);
}, () => {
    // Timeout
    countInitialPromptPlayed++;
    if (countInitialPromptPlayed > PROMPTS_NUMBER_HANGUP)
        triggerPlaybackOnInboundCall("noInput",
            "We did not receive any input, please try again later.",
            VoxEngine.terminate);
    else
        confNumberState.enter(userCall);
});

// State to check and enter the conference password.
// Once the password its entered, it forwards the call to the conference.
let confGetPasswordState = new IVRState("confgetpassword", {
        type: "inputunknown",
        terminateOn: "#",
        timeout: 10000,
        prompt: {
            say: "If your conference included a password please enter it now, followed by pound. " +
                "Just press pound to enter the conference with out a password",
            lang: TTS_VOICE
        }
    }, data => {
        // Input finished
        password = data.replace("#", "");
        triggerPlaybackOnInboundCall("confPasswordDefault",
            "Connecting you to your conference, please wait.", handleConferenceSuccessPlaybackFinished);
    }, () => confGetPasswordState.enter(userCall) // Input Timeout
);

/**
 * Call Handling Logic
 */

// Forwards call to the conference
function handleConferenceSuccessPlaybackFinished() {
    userCall.removeEventListener(CallEvents.PlaybackFinished, handleConferenceSuccessPlaybackFinished);

    Logger.write('confJID: ' + confJID);

    //bad input, something went wrong, so reset
    if (!confJID) {
        userCall.say("Error connecting your conference, please try again.", TTS_VOICE);
        userCall.addEventListener(CallEvents.PlaybackFinished, handleConferenceFailedPlaybackFinished);
        return
    }

    //we have a conference JID, so stop the IVR and forward our call
    userCall.stopPlayback();

    // set display name on outgoing call, if its anonymous skip
    let displayName = userCall.displayName();
    if (displayName && displayName !== 'anonymous')
        displayName += ` (+${userCall.callerid()})`;

    // These are needed to route the call to the correct room
    let extraHeaders = {
        "X-Room-Name": confJID,
        "X-Domain-Base": true,
        "VI-CallTimeout": 1800
    };

    // Add the password header if it exists
    if (password)
        extraHeaders['Jitsi-Conference-Room-Pass'] = password;

    jigasiCall = VoxEngine.callUser({
        username: VOXIMPLANT_USER,
        callerid: userCall.callerid(),
        displayName,
        extraHeaders,
        mixStreams: "mix",
        audioLevelExtension: true
    });

    // Handle outbound call events
    jigasiCall.addEventListener(CallEvents.InfoReceived, e => handleReceivedInfo(e));
    jigasiCall.addEventListener(CallEvents.Connected,
        () => {
            timeoutHandler(userCall, INBOUND_CALL_DURATION_LIMIT);
            // Start the in-call IVR from the InCallIVR scenario
            startIVR(userCall, jigasiCall);
        });
    jigasiCall.addEventListener(CallEvents.Failed, VoxEngine.terminate);
    jigasiCall.addEventListener(CallEvents.Disconnected, VoxEngine.terminate);

}

function triggerPlaybackOnInboundCall(eventName, eventMessage, eventHandler) {
    Logger.write(eventName + ": initiated");
    userCall.say(eventMessage, TTS_VOICE);
    userCall.addEventListener(CallEvents.PlaybackFinished, eventHandler);
}

// Wrong input - return to confNumberState
function handleConferenceFailedPlaybackFinished() {
    userCall.removeEventListener(CallEvents.PlaybackFinished, handleConferenceFailedPlaybackFinished);
    countInitialPromptPlayed = 0;
    confNumberState.enter(userCall);
}

// Handle incoming call
VoxEngine.addEventListener(AppEvents.CallAlerting, e => {
    userCall = e.call;
    // add event listeners
    userCall.addEventListener(CallEvents.Connected, () => confNumberState.enter(userCall));
    userCall.addEventListener(CallEvents.Disconnected, VoxEngine.terminate);
    userCall.addEventListener(CallEvents.Failed, VoxEngine.terminate);
    userCall.answer({}, { audioLevelExtension: true }); // answer the call
});
