import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { apiService, getStoredToken, setStoredToken } from '../services/api';

const AppContext = createContext();

export const AppProvider = ({ children }) => {
  // Authenticated identity — null until a real login (or restored session) succeeds.
  const [currentUser, setCurrentUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true); // restoring session from stored token
  const [authError, setAuthError] = useState(null);

  // Live data (fetched from the API, scoped server-side to currentUser's role)
  const [sites, setSites] = useState([]);
  const [officers, setOfficers] = useState([]);
  const [absenceLogs, setAbsenceLogs] = useState([]);
  const [lateLogs, setLateLogs] = useState([]);
  const [incidents, setIncidents] = useState([]);
  const [inspections, setInspections] = useState([]);
  const [kpis, setKpis] = useState({
    totalRequired: 0,
    totalOnDuty: 0,
    totalShortfall: 0,
    totalAbsenceCount: 0,
    totalLateCount: 0,
    absenteeismPercentage: 0,
    priorMonthPercentage: 0,
    trend: ''
  });
  // Optional custom period {from,to} (YYYY-MM-DD) for the absenteeism breakdown (UC-1).
  const [kpiRange, setKpiRange] = useState(null);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState(null);

  const refreshData = useCallback(async () => {
    setDataLoading(true);
    setDataError(null);
    try {
      // The server only answers each role for the data it may see (SRS FR-20): a client gets
      // incidents and inspections for their own sites; a guard has no web access at all.
      if (currentUser?.role === 'SECURITY_GUARD') return;
      if (currentUser?.role === 'CLIENT') {
        const [incidentRes, inspectionRes] = await Promise.all([apiService.getIncidents(), apiService.getInspections()]);
        setIncidents(incidentRes.incidents || []);
        setInspections(inspectionRes.inspections || []);
        return;
      }
      const [sitesRes, officersRes, absenceRes, lateRes, incidentRes, inspectionRes, kpiRes] = await Promise.all([
        apiService.getSites(),
        apiService.getOfficers(),
        apiService.getAbsenceLogs(),
        apiService.getLateLogs(),
        apiService.getIncidents(),
        apiService.getInspections(),
        apiService.getExecutiveKPIs(kpiRange)
      ]);
      setSites(sitesRes.sites || []);
      setOfficers(officersRes.officers || []);
      setAbsenceLogs(absenceRes.absenceLogs || []);
      setLateLogs(lateRes.lateLogs || []);
      setIncidents(incidentRes.incidents || []);
      setInspections(inspectionRes.inspections || []);
      setKpis(kpiRes.kpis || {});
    } catch (error) {
      setDataError(error.message || 'Failed to load live ISOMS data from the server');
    } finally {
      setDataLoading(false);
    }
  }, [kpiRange, currentUser?.role]);

  // On mount, try to restore a session from a previously stored token.
  useEffect(() => {
    const token = getStoredToken();
    if (!token) {
      setAuthLoading(false);
      return;
    }
    apiService.getCurrentUser()
      .then(({ user }) => {
        setCurrentUser(user);
      })
      .catch(() => {
        setStoredToken(null);
      })
      .finally(() => {
        setAuthLoading(false);
      });
  }, []);

  // Once authenticated, load role-scoped live data.
  useEffect(() => {
    // A session that still has to change its initial passcode is not allowed to read data yet.
    if (currentUser && !currentUser.mustChangePassword) {
      refreshData();
    }
  }, [currentUser, refreshData]);

  const login = async (epf, password) => {
    setAuthError(null);
    try {
      const { token, user } = await apiService.login(epf, password);
      setStoredToken(token);
      setCurrentUser(user);
      return user;
    } catch (error) {
      setAuthError(error.message || 'Authentication failed');
      throw error;
    }
  };

  // Sets a new passcode. The server replies with a fresh, unrestricted token.
  const changePassword = async (currentPassword, newPassword) => {
    const { token, user } = await apiService.changePassword(currentPassword, newPassword);
    setStoredToken(token);
    setCurrentUser(user);
  };

  const logout = () => {
    setStoredToken(null);
    setCurrentUser(null);
    setSites([]);
    setOfficers([]);
    setAbsenceLogs([]);
    setLateLogs([]);
    setIncidents([]);
    setInspections([]);
  };

  return (
    <AppContext.Provider value={{
      currentUser,
      authLoading,
      authError,
      login,
      logout,
      changePassword,
      sites,
      officers,
      absenceLogs,
      lateLogs,
      incidents,
      inspections,
      kpis,
      kpiRange,
      setKpiRange,
      dataLoading,
      dataError,
      refreshData
    }}>
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => useContext(AppContext);
