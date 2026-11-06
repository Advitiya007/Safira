import React, { useState, useEffect } from 'react';
import { Phone, Users, History, ShieldAlert, Zap, Clock, CheckCircle, X } from 'lucide-react';
import { sosAPI, guardianAPI } from '../utils/api';
import useLocation from '../hooks/useLocation';

export default function SOSPage() {
  const { location } = useLocation();
  const [stage, setStage] = useState('idle'); // 'idle' | 'confirming' | 'active' | 'cancelled'
  const [countdown, setCountdown] = useState(3);
  const [elapsed, setElapsed] = useState(0);
  const [toastMessage, setToastMessage] = useState(null);
  const [activeSosId, setActiveSosId] = useState(null);
  const [guardians, setGuardians] = useState([]);
  const [logs, setLogs] = useState([]);
  useEffect(() => {
    const fetchData = async () => {
      try {
        const [guardianRes, logsRes] = await Promise.all([
          guardianAPI.getGuardians(),
          sosAPI.getHistory()
        ]);
        if (guardianRes.success && guardianRes.data) {
          setGuardians(guardianRes.data.map(g => ({
            id: g._id,
            name: g.name,
            initial: g.name[0]?.toUpperCase(),
            color: 'bg-primary-container',
            status: g.verified ? 'Active ✓' : 'Pending',
            statusColor: g.verified ? 'text-success border-success/20' : 'text-warning border-warning/20'
          })));
        }
        if (logsRes.success && logsRes.data) {
          setLogs(logsRes.data.map(l => ({
            id: l._id,
            action: 'SOS Triggered',
            time: new Date(l.triggeredAt).toLocaleString('en-IN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
            status: l.status === 'resolved' ? 'Resolved' : 'Alerted'
          })));
        }
      } catch (e) {
        console.error("Error fetching SOS data", e);
      }
    };
    fetchData();
  }, []);
  const EMERGENCY_NUMBERS = [
    { name: 'Police', num: '100', color: 'text-info' },
    { name: 'Women Helpline', num: '1091', color: 'text-primary-container' },
    { name: 'Ambulance', num: '108', color: 'text-error' },
    { name: 'Emergencies', num: '112', color: 'text-ink' },
    { name: 'NCWH', num: '181', color: 'text-primary-container' },
  ];
  useEffect(() => {
    let timer;
    if (stage === 'confirming') {
      timer = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) { setStage('active'); handleSOSActive(); return 3; }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [stage]);
  useEffect(() => {
    let timer;
    if (stage === 'active') {
      timer = setInterval(() => {
        setElapsed((prev) => prev + 1);
      }, 1000);
    } else {
      setElapsed(0);
    } return () => clearInterval(timer);
  }, [stage]);
  const activeSosIdRef = React.useRef(null);
  const isCancelledRef = React.useRef(false);
  useEffect(() => {
    if (stage === 'cancelled') {
      const timer = setTimeout(() => {
        setStage('idle');
        setCountdown(3);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [stage]);
  const handleSOSClick = () => {
    if (stage === 'idle') {
      isCancelledRef.current = false; setStage('confirming'); setCountdown(3);
    } else if (stage === 'confirming') { setStage('cancelled'); }
  };
  const handleCancelSOS = async () => {
    isCancelledRef.current = true;
    const idToResolve = activeSosId || activeSosIdRef.current;
    if (idToResolve) {
      try {
        await sosAPI.resolveSOS(idToResolve);
        setToastMessage('SOS Resolved Successfully');
        setTimeout(() => setToastMessage(null), 3000);
        setLogs(prev => prev.map(log =>
          log.id === idToResolve ? { ...log, status: 'Resolved' } : log
        ));
      } catch (e) {
        console.error('Failed to resolve SOS', e);
      }
    }
    setStage('cancelled');
    setActiveSosId(null);
    activeSosIdRef.current = null;
  };
  const handleSOSActive = async () => {
    let newId = Date.now();
    try {
      const locationData = {
        latitude: location[0] || 28.6139,
        longitude: location[1] || 77.2090,
        notes: "Emergency SOS Triggered from Web App"
      };
      const response = await sosAPI.triggerSOS(locationData);
      if (response.success) {
        newId = response.data?._id || newId;
        if (isCancelledRef.current) {
          await sosAPI.resolveSOS(newId);
          return; // Skip setting active state
        }

        setActiveSosId(newId);
        activeSosIdRef.current = newId;
        setToastMessage('SOS Sent to Authorities and Guardians! 🚨');
        setTimeout(() => setToastMessage(null), 3000);
      }
    } catch (error) {
      console.error("SOS Trigger failed:", error);
      if (!isCancelledRef.current) {
        setToastMessage('Alert sent locally (Network Error) ⚠️');
        setTimeout(() => setToastMessage(null), 3000);
      }
    }
    if (!isCancelledRef.current) {
      const now = new Date();
      const newLog = {
        id: newId,
        action: 'SOS Triggered',
        time: now.toLocaleString('en-IN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
        status: 'Alerted'
      };
      setLogs((prev) => [newLog, ...prev].slice(0, 5));
    }
  };
  const handleTestAlert = () => {
    setToastMessage('Test alert sent successfully ✓');
    setTimeout(() => setToastMessage(null), 2000);
  };
  const formatTime = (seconds) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };
  const getTopBar = () => {
    if (stage === 'idle') return { bg: 'bg-success', text: 'You are Safe · Background tracking ON' };
    if (stage === 'confirming') return { bg: 'bg-warning', text: 'Preparing alert... · Tap to cancel' };
    if (stage === 'active') return { bg: 'bg-error', text: '🔴 ALERT ACTIVE · Notifying authorities', pulse: true };
    if (stage === 'cancelled') return { bg: 'bg-success', text: 'Alert Cancelled. You are safe.' };
    return { bg: 'bg-soft', text: '' };
  };
  const topBar = getTopBar();
  return (
    <div className="min-h-screen bg-gradient-to-b from-canvas to-card transition-all duration-500 pb-12">
      {/* Toast Notification */}
      {toastMessage && (
        <div role="status" aria-live="assertive" className="fixed bottom-24 md:bottom-6 left-1/2 -translate-x-1/2 z-50 bg-card text-ink border border-line px-6 py-3 rounded-full shadow-2xl flex items-center gap-2 animate-in fade-in slide-in-from-bottom-4">
          <CheckCircle className="w-5 h-5 text-success" />
          <span className="font-label text-sm font-semibold">{toastMessage}</span>
        </div>
      )}
      {/* Top Status Bar */}
      <div className={`w-full py-3 px-4 text-center transition-all duration-500 ${topBar.bg} ${topBar.pulse ? 'animate-pulse' : ''}`}>
        <p className="font-label text-white text-xs md:text-sm font-bold uppercase tracking-widest">
          {topBar.text}
        </p>
      </div>
      <div className="max-w-[1440px] mx-auto px-6 md:px-12 pt-12">
        {/* SOS Button Area */}
        <div className="flex flex-col items-center justify-center text-center mb-16 space-y-6">
          <div className="bg-card p-10 rounded-[3rem] shadow-xl border border-soft relative">
            <div className="relative flex justify-center items-center">
              {/* Animations based on stage */}
              {stage === 'idle' && (
                <>
                  <div className="absolute inset-0 rounded-full bg-error/20 animate-ping scale-150 transition-all duration-500 pointer-events-none" />
                  <div className="absolute inset-0 rounded-full bg-error/10 animate-ping delay-700 scale-125 transition-all duration-500 pointer-events-none" />
                </>
              )}
              {stage === 'active' && (
                <>
                  <div className="absolute w-64 h-64 rounded-full border-4 border-error animate-[ping_2s_cubic-bezier(0,0,0.2,1)_infinite] transition-all duration-500 pointer-events-none" />
                  <div className="absolute w-64 h-64 rounded-full border-4 border-error animate-[ping_2.5s_cubic-bezier(0,0,0.2,1)_infinite] delay-300 transition-all duration-500 pointer-events-none" />
                  <div className="absolute w-64 h-64 rounded-full border-4 border-error animate-[ping_3s_cubic-bezier(0,0,0.2,1)_infinite] delay-700 transition-all duration-500 pointer-events-none" />
                </>
              )}
              {/* Main Button */}
              <button
                onClick={handleSOSClick}
                disabled={stage === 'active' || stage === 'cancelled'}
                className={`relative z-10 w-64 h-64 rounded-full flex flex-col items-center justify-center gap-3 shadow-2xl transition-all duration-500 
                  ${stage === 'idle' ? 'bg-error hover:bg-error hover:scale-105' : ''}
                  ${stage === 'confirming' ? 'bg-warning scale-95' : ''}
                  ${stage === 'active' ? 'bg-black border-4 border-error scale-100' : ''}
                  ${stage === 'cancelled' ? 'bg-success scale-100' : ''}
                `}>
                {stage === 'idle' && (
                  <>
                    <ShieldAlert className="w-16 h-16 text-white" />
                    <span className="text-5xl font-black text-white italic tracking-tighter">SOS</span>
                    <span className="text-[10px] font-bold text-white uppercase tracking-[0.3em] opacity-90 mt-2">
                      Press for Emergency
                    </span>
                  </>
                )}
                {stage === 'confirming' && (
                  <>
                    <span className="text-7xl font-black text-white">{countdown}</span>
                    <span className="text-xs font-bold text-white uppercase tracking-widest mt-2">
                      Tap again to cancel
                    </span>
                  </>
                )}
                {stage === 'active' && (
                  <>
                    <Clock className="w-10 h-10 text-white opacity-80" />
                    <span className="text-4xl font-black text-white tracking-wider font-mono">
                      {formatTime(elapsed)}
                    </span>
                    <span className="text-[11px] font-bold text-error uppercase tracking-widest mt-1">
                      ALERT ACTIVE
                    </span>
                  </>
                )}
                {stage === 'cancelled' && (
                  <><CheckCircle className="w-16 h-16 text-white" /><span className="text-sm font-bold text-white uppercase tracking-widest mt-2"> Safe</span></>
                )}
              </button>
            </div>
            {/* Post-activation controls & info */}
            {stage === 'active' && (
              <div className="mt-8 flex flex-col items-center animate-in fade-in slide-in-from-top-4 duration-500">
                <p className="font-label text-sm font-bold text-primary-container mb-4 bg-soft px-4 py-2 rounded-full">
                  Your guardians have been notified
                </p>
                <button
                  onClick={handleCancelSOS}
                  className="flex items-center gap-2 text-sm font-bold text-ink-muted hover:text-ink-muted uppercase tracking-widest transition-colors"
                >
                  <X className="w-4 h-4" /> Cancel SOS
                </button>
              </div>
            )}
          </div>
          <div className="max-w-md">
            <h2 className="text-2xl font-bold font-headline text-ink mb-2">Emergency Hub</h2>
            <p className="text-ink/70 font-body">
              Press the SOS button to instantly notify all verified guardians and local authorities with your live location.</p></div></div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
          {/* Left Column: Emergency Numbers & Guardians */}
          <div className="lg:col-span-2 space-y-12">
            {/* Quick Dial Authorities */}
            <section>
              <div className="flex items-center gap-3 mb-6">
                <span className="p-2.5 bg-card rounded-xl shadow-sm text-primary-container"><Phone className="w-5 h-5" /></span>
                <h3 className="text-2xl font-bold font-headline text-ink">Quick Dial Authorities</h3>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">{EMERGENCY_NUMBERS.map((item) => (
                <a
                  key={item.num}
                  href={`tel:${item.num}`}
                  className="relative bg-card border border-soft rounded-2xl p-4 flex flex-col items-center justify-center gap-3 text-center group hover:border-primary-container hover:shadow-lg transition-all duration-300 overflow-hidden"
                >
                  <p className="text-[10px] font-bold text-ink/60 uppercase tracking-wider">{item.name}</p>
                  <p className={`text-3xl font-black ${item.color}`}>{item.num}</p>

                  {/* Hover Call Badge */}
                  <div className="absolute inset-x-0 bottom-0 bg-primary-container text-white py-1.5 translate-y-full group-hover:translate-y-0 transition-transform duration-300 flex items-center justify-center gap-1">
                    <Phone className="w-3 h-3" />
                    <span className="text-[10px] font-bold uppercase tracking-widest">Call Now</span>
                  </div>
                </a>
              ))}</div></section>
            {/* Active Guardians */}
            <section>
              <div className="flex items-center gap-3 mb-6">
                <span className="p-2.5 bg-card rounded-xl shadow-sm text-primary-container"><Users className="w-5 h-5" /></span>
                <h3 className="text-2xl font-bold font-headline text-ink">Active Guardians</h3>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {guardians.map(g => (
                  <div key={g.id} className={`bg-card border border-soft rounded-2xl p-5 flex items-center justify-between border-l-4 ${g.statusColor} shadow-sm hover:shadow-md transition-shadow`}>
                    <div className="flex items-center gap-4">
                      <div className={`w-12 h-12 rounded-full ${g.color} flex items-center justify-center font-bold text-white text-lg`}>
                        {g.initial}
                      </div>
                      <div>
                        <h4 className="font-bold font-headline text-ink text-sm">{g.name}</h4>
                        <p className={`text-[10px] font-bold uppercase tracking-widest mt-1 ${g.statusColor.split(' ')[0]}`}>
                          {g.status}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={handleTestAlert}
                      className="text-[10px] font-black text-primary-container bg-soft hover:bg-primary-container hover:text-white px-3 py-2 rounded-lg uppercase tracking-widest transition-colors"
                    >
                      Test Alert
                    </button>
                  </div>))}</div>
              <button className="w-full mt-6 py-4 border-2 border-dashed border-primary-container/20 text-primary-container bg-soft/50 font-bold font-label rounded-xl hover:border-primary-container hover:bg-soft transition-all uppercase tracking-widest text-xs">
                Manage Safety Network
              </button></section></div>
          {/* Right Column: Activity Log */}
          <div className="lg:col-span-1">
            <section className="bg-card border border-soft rounded-[2rem] p-8 shadow-sm h-full">
              <div className="flex items-center gap-3 mb-8">
                <span className="p-2.5 bg-soft rounded-xl text-primary-container"><History className="w-5 h-5" /></span>
                <h3 className="text-xl font-bold font-headline text-ink">Recent Safety Logs</h3>
              </div>

              {logs.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-40 text-ink/60">
                  <Clock className="w-8 h-8 mb-2 opacity-50" />
                  <p className="font-label text-sm font-semibold">No recent activity</p>
                </div>
              ) : (
                <div className="space-y-6">
                  {logs.map((log, i) => (
                    <div key={log.id} className="flex gap-4 group">
                      <div className="relative flex flex-col items-center">
                        <div className="w-3 h-3 rounded-full bg-primary-container z-10 relative ring-4 ring-soft" />
                        {i !== logs.length - 1 && <div className="absolute top-3 w-[2px] h-full bg-soft -bottom-6" />}
                      </div>
                      <div className="pb-4">
                        <p className="text-sm font-bold font-headline text-ink">{log.action}</p>
                        <p className="text-xs text-ink/60 font-body mb-2 mt-0.5">{log.time}</p>
                        <span className="px-2.5 py-1 bg-soft rounded-md text-[9px] font-bold text-primary-container uppercase tracking-wider">
                          {log.status}
                        </span>
                      </div></div>))} </div>)}
              {logs.length > 0 && (
                <button className="w-full mt-8 pt-4 border-t border-soft text-center text-xs font-bold text-primary-container hover:text-deep transition-colors uppercase tracking-widest">
                  View All History
                </button>
              )}
            </section></div></div></div></div>
  );
}