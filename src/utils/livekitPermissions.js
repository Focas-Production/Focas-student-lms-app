// LiveKit publish-permission helpers shared by the host's participants panel
// and the student-side guard.

// Data-message topic the server pushes on — must match NOTIFY_TOPIC in
// server/services/livekitService.js.
export const NOTIFY_TOPIC = 'focas-notify'

// Values of LiveKit's protobuf TrackSource enum, as they appear in
// `participant.permissions.canPublishSources` (livekit-client leaves them as
// raw numbers). Only the two sources a host controls.
const PROTO_SOURCE = { camera: 1, mic: 2 }

// Same rule LiveKit's own ControlBar uses to decide whether to show a button.
// `permissions` undefined means "not known yet" — treat as allowed so we never
// flash a lock we can't confirm.
export function canPublishSource(permissions, key) {
  if (!permissions) return true
  if (!permissions.canPublish) return false
  const sources = permissions.canPublishSources || []
  return sources.length === 0 || sources.includes(PROTO_SOURCE[key])
}

export const SOURCE_LABEL = { mic: 'microphone', camera: 'camera' }
