import { Component } from 'react'

// Catches render-time crashes so a broken subtree shows a readable message
// instead of a blank white screen (React unmounts the whole tree otherwise).
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 60, background: '#0b0b0f', color: '#fff',
          padding: 24, overflow: 'auto', fontFamily: 'monospace',
        }}>
          <p style={{ color: '#f87171', fontWeight: 700, marginBottom: 8 }}>Something went wrong in the live room</p>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, color: '#fca5a5' }}>
            {String(this.state.error?.message || this.state.error)}
          </pre>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 11, color: '#9ca3af', marginTop: 12 }}>
            {this.state.error?.stack}
          </pre>
          <button onClick={() => { this.setState({ error: null }); this.props.onReset?.() }}
            style={{ marginTop: 16, padding: '8px 16px', borderRadius: 8, background: '#374151', color: '#fff', border: 'none', cursor: 'pointer' }}>
            Close
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
