import React, { useState, useEffect } from 'react';
import axios from 'axios';
import Sidebar from './Sidebar';
import Overview from './Overview';
import Attendance from './Attendance';
import Results from './Results';
import Resources from './Resources';
import Chat from './Chat';
import Timetable from './Timetable';
import Settings from './Settings';
import OverviewResourcesBox from './OverviewResourcesBox';

const gradientOptions = [
  { value: 'daybreak', label: 'Daybreak' },
  { value: 'oceanic', label: 'Oceanic' },
  { value: 'dusky', label: 'Dusky' },
  { value: 'midnight', label: 'Midnight' }
];

const Dashboard = ({ user, onLogout, onThemeToggle, gradient, onGradientChange }) => {
  const [currentView, setCurrentView] = useState('all');
  const [currentSemester, setCurrentSemester] = useState(user?.currentSemester || 3);
  const [currentSection, setCurrentSection] = useState(user?.currentSection || 'CS-A');
  const [pinnedItems, setPinnedItems] = useState(['attendance']);
  const [showSettings, setShowSettings] = useState(false);
  const [semestersList, setSemestersList] = useState([]);
  const [preselectedSubject, setPreselectedSubject] = useState(null);
  useEffect(() => {
    fetchSemestersList();
  }, []);

  const fetchSemestersList = async () => {
    try {
      const token = localStorage.getItem('token');
      const headers = {};
      if (token) headers['x-auth-token'] = token;

      try {
        const cacheRes = await axios.get('/api/resources/semesters/cached', {
          withCredentials: true,
          headers
        });
        if (cacheRes.data?.semesters?.length) {
          setSemestersList(cacheRes.data.semesters);
          return;
        }
      } catch (cacheError) {
        // continue to live fetch
      }

      const liveRes = await axios.get('/api/resources/html/semesters', {
        withCredentials: true,
        headers
      });
      if (liveRes.data?.semesters?.length) {
        setSemestersList(liveRes.data.semesters);
      }
    } catch (error) {
      console.error('Failed to fetch semesters list:', error);
    }
  };

  useEffect(() => {
    updateSettings();
  }, [currentSemester, currentSection]);

  const updateSettings = async () => {
    try {
      await axios.post('/api/auth/settings', {
        currentSemester,
        currentSection
      });
    } catch (error) {
      console.error('Failed to update settings:', error);
    }
  };

  const handleLogout = async () => {
    await onLogout();
  };

  const pinToggle = (key) => {
    setPinnedItems(prev => 
      prev.includes(key) 
        ? prev.filter(k => k !== key)
        : [...prev, key]
    );
  };

  const singleView = currentView !== 'all';

  return (
    <div className="container">
      <div className="topbar">
        <div className="flex">
          <div style={{ fontWeight: 700, fontSize: '18px' }}>
            Welcome back, {user?.name || user?.srn || 'Student'}
          </div>
          <div className="muted" style={{ marginLeft: '10px' }}>— PESUConnect</div>
        </div>
        <div className="flex">
          <div className="hotbar" id="hotbar">
            {['attendance', 'timetable', 'resources', 'chat'].map(key => (
              <div
                key={key}
                className={`chip ${pinnedItems.includes(key) ? 'pinned' : ''}`}
                data-key={key}
                onClick={() => setCurrentView(key)}
              >
                {key.charAt(0).toUpperCase() + key.slice(1)}
              </div>
            ))}
            <select
              className="chip chip-select"
              value={gradient}
              onChange={(e) => {
                if (e.target.value === '__toggle_theme__') {
                  onThemeToggle?.();
                  return;
                }
                onGradientChange?.(e.target.value);
              }}
              title="Select theme / gradient"
            >
              <option value="__toggle_theme__">Toggle Light/Dark</option>
              {gradientOptions.map(opt => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <div className="chip" onClick={() => setShowSettings(true)} title="Settings">
              Settings
            </div>
          </div>
          <button className="btn ghost" style={{ marginLeft: '12px' }} onClick={handleLogout}>
            Logout
          </button>
        </div>
      </div>

      <div className={`main ${singleView ? 'single-view' : ''}`}>
        <Sidebar
          currentView={currentView}
          currentSemester={currentSemester}
          currentSection={currentSection}
          onViewChange={setCurrentView}
          onSemesterChange={setCurrentSemester}
          onSectionChange={setCurrentSection}
          semesters={semestersList}
        />

        <div className="left-col">
          {currentView === 'all' && (
            <OverviewResourcesBox 
              user={user} 
              semester={currentSemester}
              onNavigateToResources={(data) => {
                setCurrentSemester(data.semester);
                setPreselectedSubject(data);
                setCurrentView('resources');
              }}
            />
          )}
        </div>

        <div id="rightCol">
          {currentView === 'all' && (
            <Overview
              user={user}
              semester={currentSemester}
              section={currentSection}
              onNavigateToResources={(data) => {
                setCurrentSemester(data.semester);
                setPreselectedSubject(data);
                setCurrentView('resources');
              }}
            />
          )}
          {currentView === 'attendance' && (
            <Attendance user={user} semester={currentSemester} />
          )}
          {currentView === 'timetable' && (
            <Timetable compact={false} mode="week" />
          )}
          {currentView === 'resources' && (
            <Resources 
              user={user} 
              semester={currentSemester} 
              compact={false}
              preselectedSubject={preselectedSubject}
              onSubjectSelected={() => setPreselectedSubject(null)}
            />
          )}
          {currentView === 'results' && (
            <Results user={user} semester={currentSemester} compact={false} />
          )}
          {currentView === 'chat' && (
            <Chat user={user} section={currentSection} />
          )}
        </div>
      </div>

      <footer>PESUConnect — Connected to backend API</footer>

      {showSettings && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000
        }} onClick={() => setShowSettings(false)}>
          <div onClick={(e) => e.stopPropagation()}>
            <Settings user={user} onClose={() => setShowSettings(false)} />
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;

