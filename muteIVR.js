require(Modules.IVR);

// Global declarations
let audioMuted = false;                     // is the audio currently muted
let jigasiCall, userCall;

/*** Adjust this constants for your installation ***/
const repromptTime = 30 * 10 * 1000;        // How long to wait before reminding users of their mute state

/**
 * IVR States and startup
 */

const muteIvrState = new IVRState("muteToggle", {
    type: "inputfixed",
    inputLength: 2,
    timeout: repromptTime,
    prompt: {
        say: "You are muted, press star 6 to un mute"
    }
}, data => {
    Logger.write(`DEBUG: muteToggle IVR input was ${data} `);
    if (data === '*6')
        sendMuteRequestToCall(jigasiCall, false);
}, data => {
    Logger.write(`DEBUG: muteToggle IVR timeout ${data} `);
    muteIvrState.enter(userCall);
});

const unMuteIvrState = new IVRState("unMuteToggle", {
    type: "inputfixed",
    inputLength: 2,
    timeout: repromptTime,
    prompt: {
        say: "You are un muted, press star 6 to mute"
    }
}, data => {
    Logger.write(`DEBUG: unMuteToggle IVR input was ${data} `);
    if (data === '*6')
        sendMuteRequestToCall(jigasiCall, true);
}, data => {
    Logger.write(`DEBUG: unMuteToggle IVR timeout ${data} `);
    unMuteIvrState.enter(userCall);
});

// Start the IVR - specify the user-leg first followed by the jigasi-leg
function startIVR(user, jigasi) {
    Logger.write(`DEBUG: Initializing muteIVR. audioMuted is ${audioMuted}`);
    userCall = user;
    jigasiCall = jigasi;
    userCall.addEventListener(CallEvents.PlaybackFinished, () => VoxEngine.sendMediaBetween(userCall, jigasiCall) );

    // Check if the user should start muted
    if(audioMuted)
        muteIvrState.enter(userCall);
    else
        unMuteIvrState.enter(userCall);
}

/**
 * Shared global helper functions for the In-call IVR
 */

function handleReceivedInfo(e) {
    Logger.write("DEBUG::handleReceivedInfo");

    if (e.mimeType === 'application/json') {

        let obj = JSON.parse(e.body);

        if (obj.type && obj.type === "muteRequest") {
            sendMuteResponseToCall(e.call, obj);

            if (userCall && userCall.state() === 'CONNECTED') {
                audioMuted = obj.data.audio;
                Logger.write(`DEBUG: muteRequest with ${obj.id} succeeded. audioMuted state is ${audioMuted}.\n`);
                muteIvrState.enter(userCall);
            } else {
                audioMuted = true;
                Logger.write("DEBUG: muteRequest - outbound call is not connected yet, starting Muted");
            }
        } else if (obj.type && obj.type === "muteResponse") {
            if (obj.status && obj.status === "OK") {
                audioMuted = audioMuted !== true;
                Logger.write(`DEBUG: muteResponse with ${obj.id} succeeded. audioMuted state is ${audioMuted}.\n`);
                if(audioMuted)
                    muteIvrState.enter(userCall);
                else
                    unMuteIvrState.enter(userCall);

            } else if (obj.status
                && obj.status === "FAILED") {
                Logger.write(`DEBUG: muteResponse with ${obj.id} failed`);
            }
        }
        else {
            Logger.write(`DEBUG: message handle error message: ${JSON.stringify(obj)}`)
        }
    }
}

function sendMuteRequestToCall(call, muted) {
    let request = {
        type: "muteRequest",
        id: uuidgen(),
        data: {
            audio: muted
        }
    };

    Logger.write(`DEBUG: Sending mute request: ${JSON.stringify(request)}`);
    call.sendInfo("application/json", JSON.stringify(request));
}

function sendMuteResponseToCall(call, request) {
    let response = {
        type: "muteResponse",
        id: request.id,
        status: "OK",
        data: {
            audio: request.data.audio
        }
    };

    Logger.write(`DEBUG: Sending mute response: ${JSON.stringify(response)}`);
    call.sendInfo("application/json", JSON.stringify(response));
}

// Limit the call to the specified duration to prevent abuse and accidental charges
function timeoutHandler(call, maxDuration) {
    Logger.write(`DEBUG: Started call limit timeout after Call Connected Listener. Waiting for ${maxDuration} ms`);
    setTimeout(() => {
        Logger.write('DEBUG: call limit timeout reached');

        call.addEventListener(CallEvents.PlaybackFinished, VoxEngine.terminate);
        call.say('Time limit exceeded. Thank you for trying out our service.');

    }, maxDuration);
}
