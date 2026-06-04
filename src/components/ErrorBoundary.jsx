import { Component } from 'react';

// Catches render-time errors in its subtree so one bad session/view can't blank
// out the whole app. Provide a `fallback(error, reset)` render prop, or use the
// default. Give it a `key` that changes on navigation so moving away clears it.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
    this.reset = () => this.setState({ error: null });
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('ErrorBoundary caught an error:', error, info);
  }

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback(this.state.error, this.reset);
      return (
        <div className="error-boundary">
          <h2>Something went wrong</h2>
          <p>{String(this.state.error?.message || this.state.error)}</p>
          <button className="btn btn-primary" onClick={this.reset}>Try again</button>
        </div>
      );
    }
    return this.props.children;
  }
}
