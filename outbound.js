// Global declarations
let jigasiCall,      // holder for the call from Jigasi
    userCall,        // holder for the PSTN call to the user
    confInputMenu;

/*** Adjust these constants for your installation ***/
const OUTBOUND_CALL_DURATION_LIMIT = 5 * 60 * 1000;     // Max call duration allowed
const TTS_VOICE = Language.US_ENGLISH_FEMALE;           // Choose your preferred voice
// Enter the DIDs assigned to Jigasi here
const DIDS = [
    '18572707025'
];

/**
 * Call Handling Logic
 */

// Place the outbound call
function startOutboundCall(){
    Logger.write("DEBUG: starting outbound call to user");

    // Choose an outbound callerID to use for the call in case DIDs has more than one
    let didIndex = DIDS.findIndex(
        did => PhoneNumber.getInfo(did).region === PhoneNumber.getInfo(jigasiCall.number()).region);
    let callerId = DIDS[didIndex] ? DIDS[didIndex] : DIDS[0];

    // Call the PSTN number
    userCall = VoxEngine.callPSTN(jigasiCall.number(), callerId);

    // Handle outbound call events
    userCall.addEventListener(CallEvents.Ringing, () => jigasiCall.ring());
    userCall.addEventListener(CallEvents.InfoReceived,
        e => jigasiCall.sendInfo(e.mimeType, e.body, e.headers) );
    userCall.addEventListener(CallEvents.Connected, ()=>{
        timeoutHandler(userCall, OUTBOUND_CALL_DURATION_LIMIT);

        // Start the in-call muteIVR scenario
        VoxEngine.sendMediaBetween(jigasiCall, userCall);
        startIVR(userCall, jigasiCall);

    });
    userCall.addEventListener(CallEvents.Failed, VoxEngine.terminate);
    userCall.addEventListener(CallEvents.Disconnected, VoxEngine.terminate);
}

// Kick things off when we have an incoming call event from Jigasi
VoxEngine.addEventListener(AppEvents.CallAlerting,  e => {
    Logger.write("DEBUG: inbound call from Jigasi");

    jigasiCall = e.call;
    jigasiCall.answer({}, {mixStreams: "mix", audioLevelExtension: true});

    // we need to make sure we do not miss any received info (start muted)
    jigasiCall.addEventListener(CallEvents.InfoReceived, info => handleReceivedInfo(info));

    // meet.jit.si uses an external authorization API to verify authorized phone numbers here before proceeding

    // Play a prompt and start the outbound call
    jigasiCall.addEventListener(CallEvents.PlaybackFinished, startOutboundCall);
    jigasiCall.say(`Calling ${jigasiCall.number().slice(2,).split('').join(" ")}. ` +
        `Your call will be automatically ended in ${OUTBOUND_CALL_DURATION_LIMIT / (60 * 1000)} minutes.`);
});
