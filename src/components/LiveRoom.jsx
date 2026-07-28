import { LiveKitRoom, VideoConference } from '@livekit/components-react'
import '@livekit/components-styles'
import ErrorBoundary from './ErrorBoundary'

// The live class room. Uses LiveKit's prebuilt <VideoConference>, which is fully
// responsive (phone / tablet / laptop / desktop): the control bar collapses to
// icons on narrow screens, chat becomes a full-screen overlay on mobile, and the
// stage switches between grid and screen-share focus automatically. It also
// renders room audio and handles connection/reconnection states internally.
export default function LiveRoom(props) {
  return (
    <ErrorBoundary onReset={props.onLeave}>
      <LiveRoomInner {...props} />
    </ErrorBoundary>
  )
}

function LiveRoomInner({ token, wsUrl, title, onLeave }) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, background: '#0b0b0f' }}>
      <LiveKitRoom
        token={token}
        serverUrl={wsUrl}
        connect
        // Everyone joins muted; they turn their own camera/mic on from the control bar.
        video={false}
        audio={false}
        onDisconnected={onLeave}
        data-lk-theme="default"
        style={{ height: '100dvh' }}
      >
        {title && (
          <div style={{
            position: 'absolute', top: 8, left: 8, zIndex: 20,
            background: 'rgba(0,0,0,0.55)', color: '#fff', fontSize: 12, fontWeight: 600,
            padding: '4px 10px', borderRadius: 8, pointerEvents: 'none',
            maxWidth: '70vw', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            🔴 {title}
          </div>
        )}
        <VideoConference />
      </LiveKitRoom>
    </div>
  )
}
