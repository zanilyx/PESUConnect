import React, { useState, useEffect } from 'react';
import axios from 'axios';
import Login from './components/Login';
import Dashboard from './components/Dashboard';
import './index.css';

axios.defaults.withCredentials = true;

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'light');
  const [gradient, setGradient] = useState(() => localStorage.getItem('gradient') || 'daybreak');

  useEffect(() => {
    document.body.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    document.body.setAttribute('data-gradient', gradient);
    localStorage.setItem('gradient', gradient);
  }, [gradient]);

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      // Try to get token from localStorage as fallback
      const token = localStorage.getItem('token');
      const headers = {};
      if (token) {
        headers['x-auth-token'] = token;
      }
      
      const res = await axios.get('/api/auth/me', {
        withCredentials: true,
        headers: headers
      });
      setUser(res.data.user);
    } catch (error) {
      console.error('Auth check failed:', error.response?.status, error.response?.data);
      // Clear invalid token
      localStorage.removeItem('token');
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = (userData) => {
    setUser(userData);
  };

  const handleLogout = async () => {
    try {
      await axios.post('/api/auth/logout');
      setUser(null);
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  const toggleTheme = () => {
    setTheme(prev => (prev === 'light' ? 'dark' : 'light'));
  };

  const handleGradientChange = (value) => {
    setGradient(value);
  };

  if (loading) {
    return <div className="container">Loading...</div>;
  }

  return (
    <div className="App">
      {user ? (
        <Dashboard
          user={user}
          onLogout={handleLogout}
          onThemeToggle={toggleTheme}
          gradient={gradient}
          onGradientChange={handleGradientChange}
        />
      ) : (
        <Login onLogin={handleLogin} />
      )}
    </div>
  );
}

export default App;

