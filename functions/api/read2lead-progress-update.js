// Retired: a client must never choose completion IDs or reward amounts.
// Current lessons submit evidence through submit-read2lead-lesson; story
// missions use server-owned assessments and their durable reward receipts.
// Do not redirect or forward this body into either completion handler.
export function onRequestPost() {
  return Response.json({ok:false,error:'client_reward_updates_removed'}, {
    status:410,
    headers:{'Cache-Control':'no-store'},
  });
}
