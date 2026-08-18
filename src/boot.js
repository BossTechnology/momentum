/* src/boot.js — the ONE line that turns the static demo into the deployed app.

   MOMENTUM_API_BASE is what switches the heavy ingest path, profile
   persistence and BOBee from "not available" to "call the function". It must
   stay UNDEFINED when the page is opened from disk: every suite loads the
   build over file://, and identity45 asserts an untouched board is byte-
   identical to Simulation_19. Setting it unconditionally would put the gates
   on a network path they were never written to expect.

   localhost and 127.0.0.1 are excluded for the same reason the deployed repo
   excludes them: `vercel dev` serves over http, so a file:// check alone would
   switch a local preview onto the production path and fail with no key. This
   matches the script already running in production. */
(function () {
  var h = location.hostname;
  var isLocal = h === 'localhost' || h === '127.0.0.1' || location.protocol === 'file:';
  if (!isLocal) { window.MOMENTUM_API_BASE = '/api'; }
})();
