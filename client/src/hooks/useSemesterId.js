import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { parseSemesters } from '../utils/pesuScraper';

export const useSemesterId = (semester) => {
  const [semesterId, setSemesterId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const loadSemesterId = useCallback(async () => {
    if (!semester) {
      setSemesterId(null);
      return null;
    }

    try {
      setLoading(true);
      setError(null);

      const token = localStorage.getItem('token');
      const headers = {};
      if (token) headers['x-auth-token'] = token;

      try {
        const cacheRes = await axios.get('/api/resources/semesters/cached', {
          withCredentials: true,
          headers
        });
        const cachedSemesters = cacheRes.data?.semesters || [];
        const cachedMatch = cachedSemesters.find(s => s.semNumber === semester);
        if (cachedMatch?.semId) {
          setSemesterId(cachedMatch.semId);
          return cachedMatch.semId;
        }
      } catch (cacheError) {
        // ignore and fall back to live fetch
      }

      const res = await axios.get('/api/resources/html/semesters', {
        withCredentials: true,
        headers
      });

      const serverSemesters = res.data?.semesters || [];
      let currentSem = serverSemesters.find(s => s.semNumber === semester);

      if (!currentSem) {
        const parsedSemesters = parseSemesters(res.data?.html || '');
        const fallbackMatch = parsedSemesters.find(s => s.sem === semester);
        if (fallbackMatch) {
          currentSem = { semId: fallbackMatch.id, semNumber: fallbackMatch.sem, label: fallbackMatch.label };
        } else {
          const altMatch = parsedSemesters.find(s => {
            const semNumber = s.sem ?? s.semNumber;
            return semNumber === semester;
          });
          if (altMatch) {
            currentSem = {
              semId: altMatch.id || altMatch.semId,
              semNumber: altMatch.sem ?? altMatch.semNumber,
              label: altMatch.label
            };
          }
        }
      }

      if (currentSem?.semId) {
        setSemesterId(currentSem.semId);
        return currentSem.semId;
      }

      setError('Could not determine semester ID from PESU Academy.');
      return null;
    } catch (err) {
      console.error('Failed to fetch semester ID:', err);
      setError('Could not fetch semester list from PESU Academy. Please ensure your PESU credentials are saved.');
      return null;
    } finally {
      setLoading(false);
    }
  }, [semester]);

  useEffect(() => {
    if (semester) {
      loadSemesterId();
    } else {
      setSemesterId(null);
    }
  }, [semester, loadSemesterId]);

  return {
    semesterId,
    loading,
    error,
    reload: loadSemesterId
  };
};


