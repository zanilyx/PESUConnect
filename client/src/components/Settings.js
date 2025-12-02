import React, { useState } from 'react';
import axios from 'axios';

const Settings = ({ user, onClose }) => {
  const [pesuUsername, setPesuUsername] = useState('');
  const [pesuPassword, setPesuPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');
    setLoading(true);

    try {
      const response = await axios.post('/api/auth/pesu-credentials', {
        pesuUsername,
        pesuPassword
      }, {
        withCredentials: true
      });
      
      setMessage('PESU credentials saved successfully!');
      setPesuUsername('');
      setPesuPassword('');
      
      // Refresh user data - reload page to update user state
      setTimeout(() => {
        if (onClose) {
          onClose();
        }
        window.location.reload();
      }, 1500);
    } catch (err) {
      const errorMsg = err.response?.data?.error || 'Failed to save credentials';
      setError(errorMsg);
      console.error('Error saving credentials:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card" style={{ maxWidth: '500px', margin: '20px auto' }}>
      <div className="title">PESU Academy Settings</div>
      <div className="sub">Enter your PESU Academy login credentials to access resources</div>

      {message && (
        <div style={{ color: 'var(--success)', marginTop: '12px', padding: '8px', background: 'rgba(16, 185, 129, 0.1)', borderRadius: '8px' }}>
          {message}
        </div>
      )}

      {error && (
        <div style={{ color: 'var(--danger)', marginTop: '12px', padding: '8px', background: 'rgba(239, 68, 68, 0.1)', borderRadius: '8px' }}>
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ marginTop: '16px' }}>
        <div className="form-row">
          <label>PESU Academy Username</label>
          <input
            type="text"
            value={pesuUsername}
            onChange={(e) => setPesuUsername(e.target.value)}
            placeholder="Your PESU Academy username"
            required
          />
        </div>
        <div className="form-row">
          <label>PESU Academy Password</label>
          <input
            type="password"
            value={pesuPassword}
            onChange={(e) => setPesuPassword(e.target.value)}
            placeholder="Your PESU Academy password"
            required
          />
        </div>
        <div className="form-row" style={{ marginTop: '18px', display: 'flex', gap: '10px' }}>
          <button type="submit" className="btn" disabled={loading}>
            {loading ? 'Saving...' : 'Save Credentials'}
          </button>
          {onClose && (
            <button type="button" className="btn ghost" onClick={onClose}>
              Cancel
            </button>
          )}
        </div>
      </form>

      <div style={{ marginTop: '12px', fontSize: '12px', color: 'var(--muted)' }}>
        <strong>Note:</strong> Your credentials are encrypted and stored securely. They are only used to fetch your course resources from PESU Academy.
      </div>
    </div>
  );
};

export default Settings;

