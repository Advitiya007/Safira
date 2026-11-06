import React, { useCallback, useState, useEffect } from 'react';
import { UserPlus, Shield, Phone, Edit2, Trash2, CheckCircle, Clock, Loader2, Info, Eye, EyeOff } from 'lucide-react';
import { guardianAPI } from '../utils/api';
function VerificationButton({ guardian, onVerify }) {
    const [status, setStatus] = useState('idle'); // idle, verifying, cooldown
    const [timeLeft, setTimeLeft] = useState(0);

    const handleClick = () => {
        setStatus('verifying'); setTimeout(() => {
            onVerify(guardian); setStatus('cooldown'); setTimeLeft(60);
        }, 1500);
    };
    useEffect(() => {
        if (status === 'cooldown' && timeLeft > 0) {
            const t = setTimeout(() => setTimeLeft(timeLeft - 1), 1000);
            return () => clearTimeout(t);
        }
    }, [status, timeLeft]);
    if (status === 'verifying') {
        return <span className="text-info font-bold flex items-center gap-2 text-sm"><Loader2 className="w-4 h-4 animate-spin" /> Sending...</span>;
    }
    if (status === 'cooldown' && timeLeft > 0) {
        return <span className="text-ink-muted font-bold flex items-center gap-2 text-sm"><Clock className="w-4 h-4" /> Resend? ({timeLeft}s)</span>;
    }

    return (
        <button onClick={handleClick} className="text-info font-bold hover:underline flex items-center gap-2 text-sm">           <Clock className="w-4 h-4" /> Send Verification       </button>
    );
}

export default function GuardianNetworkPage() {
    const [guardians, setGuardians] = useState([]);
    const [formData, setFormData] = useState({ guardianName: '', guardianPhone: '', relationship: 'Friend' });
    const [editingGuardian, setEditingGuardian] = useState(null);
    const [revealedPhones, setRevealedPhones] = useState({});
    const [toast, setToast] = useState(null); // { message, type }
    const MAX_GUARDIANS = 5;
    const isLimitReached = guardians.length >= MAX_GUARDIANS;
    const showToast = useCallback((message, type = 'success') => {
        setToast({ message, type });
    }, []);

    useEffect(() => {
        const fetchGuardians = async () => {
            try {
                const response = await guardianAPI.getGuardians();
                if (response.success && response.data) {
                    setGuardians(response.data);
                }
            } catch (error) {
                console.error("Failed to fetch guardians", error);
                showToast("Failed to load guardians", "error");
            }
        };
        fetchGuardians();
    }, [showToast]);
    useEffect(() => {
        if (toast) {
            const timer = setTimeout(() => setToast(null), 3000);
            return () => clearTimeout(timer);
        }
    }, [toast]);
    useEffect(() => {
        const handleEsc = (e) => {
            if (e.key === 'Escape') setEditingGuardian(null);
        };
        window.addEventListener('keydown', handleEsc);
        return () => window.removeEventListener('keydown', handleEsc);
    }, []);
    const handleAdd = async (e) => {
        e.preventDefault();
        if (!formData.guardianName || !formData.guardianPhone || isLimitReached) return;
        try {
            const response = await guardianAPI.addGuardian(formData);
            if (response.success && response.data) {
                setGuardians([...guardians, response.data]); setFormData({ guardianName: '', guardianPhone: '', relationship: 'Friend' }); showToast('Guardian added successfully');
            }
        } catch (err) {
            showToast(err.message || 'Failed to add guardian', 'error');
        }
    };
    const removeGuardian = async (id) => {
        try {
            await guardianAPI.removeGuardian(id);
            setGuardians(guardians.filter(g => (g._id || g.id) !== id));
            showToast('Guardian removed');
        } catch {
            showToast('Failed to remove guardian', 'error');
        }
    };
    const handleEditSubmit = async (e) => {
        e.preventDefault();
        if (!editingGuardian.guardianName || !editingGuardian.guardianPhone) return;
        try {
            const response = await guardianAPI.updateGuardian(editingGuardian._id || editingGuardian.id, editingGuardian);
            if (response.success && response.data) {
                setGuardians(guardians.map(g => (g._id || g.id) === (editingGuardian._id || editingGuardian.id) ? response.data : g));
                setEditingGuardian(null);
                showToast('Guardian updated successfully');
            }
        } catch {
            showToast('Failed to update guardian', 'error');
        }
    };
    const handleVerifySuccess = (guardian) => {
        showToast(`Verification request prepared for ${maskPhone(guardian.guardianPhone)}`);
    };
    const handleTestAlert = (guardian) => {
        showToast(`Test alert sent to ${guardian.guardianName}`, 'success');
    };
    const getAvatarColor = (rel) => {
        const colors = {
            'Mom': 'bg-[#C94A7D]', 'Dad': 'bg-[#4B7FBE]', 'Sister': 'bg-[#7C3AED]', 'Brother': 'bg-[#EA580C]', 'Friend': 'bg-[#0D9488]', 'Partner': 'bg-[#DB2777]', 'Other': 'bg-[#6B7280]'
        };
        return colors[rel] || colors['Other'];
    };
    const getInitials = (name) => {
        if (!name) return '??';
        return name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
    };
    const maskPhone = (phone = '') => `••••••${phone.slice(-4)}`;
    return (
        <div className="max-w-7xl mx-auto px-8 py-12 relative">

            {/* Toast Notification */}
            {toast && (
                <div role="status" aria-live="polite" className="fixed bottom-24 md:bottom-8 left-1/2 -translate-x-1/2 z-[2000] bg-card text-ink border border-line px-6 py-3 rounded-full shadow-2xl flex items-center gap-2 animate-in fade-in slide-in-from-bottom-4">
                    <CheckCircle className="w-5 h-5 text-success" />
                    <span className="font-label text-sm font-semibold">{toast.message}</span>
                </div>)}
            {/* Edit Modal */}
            {editingGuardian && (
                <div
                    className="fixed inset-0 bg-deeper/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-200"
                    onClick={() => setEditingGuardian(null)}
                >
                    <div
                        className="bg-card max-w-[480px] w-full rounded-2xl shadow-2xl p-8 animate-in zoom-in-95 duration-200"
                        onClick={e => e.stopPropagation()}
                    >
                        <h3 className="text-2xl font-bold font-serif text-primary-container mb-6">Edit Guardian</h3>
                        <form onSubmit={handleEditSubmit} className="space-y-4">
                            <div className="space-y-2">
                                <label className="form-label text-sm font-bold text-ink-muted">Full Name</label>
                                <input
                                    type="text"
                                    className="form-input w-full p-3 bg-canvas border border-line rounded-xl focus:border-primary-container outline-none"
                                    value={editingGuardian.guardianName || ''}
                                    onChange={(e) => setEditingGuardian({ ...editingGuardian, guardianName: e.target.value })}
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="form-label text-sm font-bold text-ink-muted">Phone Number</label>
                                <input
                                    type="tel"
                                    className="form-input w-full p-3 bg-canvas border border-line rounded-xl focus:border-primary-container outline-none"
                                    value={editingGuardian.guardianPhone || ''}
                                    onChange={(e) => setEditingGuardian({ ...editingGuardian, guardianPhone: e.target.value })}
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="form-label text-sm font-bold text-ink-muted">Relationship</label>
                                <select
                                    className="form-input w-full p-3 bg-canvas border border-line rounded-xl focus:border-primary-container outline-none"
                                    value={editingGuardian.relationship}
                                    onChange={(e) => setEditingGuardian({ ...editingGuardian, relationship: e.target.value })}
                                >
                                    <option>Mom</option>                                   <option>Dad</option>                                  <option>Sister</option>                                   <option>Brother</option>                                    <option>Friend</option>                                   <option>Partner</option><option>Other</option>
                                </select>
                            </div>
                            <div className="flex gap-4 mt-8 pt-4 border-t border-line">
                                <button
                                    type="button"
                                    onClick={() => setEditingGuardian(null)}
                                    className="flex-1 py-3.5 bg-soft text-ink-muted font-bold rounded-xl hover:bg-soft transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    className="flex-1 py-3.5 bg-primary-container text-white font-bold rounded-xl hover:bg-primary-hover transition-colors shadow-lg shadow-primary/20"
                                >
                                    Save Changes
                                </button>
                            </div>                       </form>                    </div>                </div>
            )}
            <header className="mb-10">
                <h1 className="text-4xl font-bold font-serif text-primary-container mb-3 tracking-tight">Guardian Network</h1>
                <p className="text-ink-muted font-body text-lg">Manage your inner circle of trusted people who will be notified in emergencies.</p>
            </header>
            {/* Guardian Limit Indicator */}
            <div className="bg-card rounded-2xl p-6 shadow-sm border border-line mb-8 flex flex-col md:flex-row items-center justify-between gap-6">
                <div>
                    <h3 className="font-bold text-ink text-lg">Guardian Slots: {guardians.length} / {MAX_GUARDIANS} used</h3>
                    <p className="text-xs font-bold text-primary-container mt-1 bg-primary-container/10 inline-block px-2 py-1 rounded-md">Upgrade to Premium for unlimited guardians</p>
                </div>
                <div className="w-full md:w-72 h-3 bg-soft rounded-full overflow-hidden">
                    <div
                        className={`h-full transition-all duration-500 ${isLimitReached ? 'bg-error' : 'bg-primary-container'}`}
                        style={{ width: `${(guardians.length / MAX_GUARDIANS) * 100}%` }}
                    />
                </div></div>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
                {/* Left Column: Form */}
                <div className="lg:col-span-1">
                    <div className="card-premium h-fit border border-line shadow-xl shadow-primary/5">
                        <div className="flex items-center gap-3 mb-6 text-primary-container">
                            <UserPlus className="w-6 h-6" />
                            <h3 className="text-xl font-bold font-serif text-ink">Add New Guardian</h3>
                        </div>
                        {isLimitReached ? (
                            <div className="bg-error/10 text-error p-4 rounded-xl border border-error/20 flex items-start gap-3 mb-4">
                                <Info className="w-5 h-5 flex-shrink-0 mt-0.5" />
                                <p className="text-sm font-bold">Limit reached. Upgrade to Premium to add more trusted contacts.</p>
                            </div>
                        ) : (
                            <form onSubmit={handleAdd} className="space-y-5">
                                <div className="space-y-2">
                                    <label className="text-xs font-bold text-ink-muted uppercase tracking-wider">Full Name</label>
                                    <input
                                        type="text"
                                        placeholder="e.g. John Doe"
                                        className="w-full p-3.5 bg-canvas border border-line rounded-xl focus:bg-card focus:border-primary-container outline-none transition-all"
                                        value={formData.guardianName}
                                        onChange={(e) => setFormData({ ...formData, guardianName: e.target.value })}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-xs font-bold text-ink-muted uppercase tracking-wider">Phone Number</label>
                                    <input
                                        type="tel"
                                        placeholder="+91 XXXXXXXXXX"
                                        className="w-full p-3.5 bg-canvas border border-line rounded-xl focus:bg-card focus:border-primary-container outline-none transition-all"
                                        value={formData.guardianPhone}
                                        onChange={(e) => setFormData({ ...formData, guardianPhone: e.target.value })}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-xs font-bold text-ink-muted uppercase tracking-wider">Relationship</label>
                                    <select
                                        className="w-full p-3.5 bg-canvas border border-line rounded-xl focus:bg-card focus:border-primary-container outline-none transition-all appearance-none"
                                        value={formData.relationship}
                                        onChange={(e) => setFormData({ ...formData, relationship: e.target.value })}
                                    >
                                        <option>Mom</option>
                                        <option>Dad</option>
                                        <option>Sister</option>
                                        <option>Brother</option>
                                        <option>Friend</option>
                                        <option>Partner</option>
                                        <option>Other</option>
                                    </select>
                                </div>
                                <button type="submit" className="w-full mt-4 py-3.5 bg-primary-container hover:bg-primary-hover text-white font-bold rounded-xl transition-all shadow-lg shadow-primary/20">
                                    Add Guardian
                                </button>
                            </form>
                        )}
                    </div>
                </div>

                {/* Right Column: List */}
                <div className="lg:col-span-2 space-y-6">

                    {guardians.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-20 text-center bg-card rounded-3xl border-2 border-dashed border-line">
                            <div className="w-20 h-20 bg-primary-container/10 rounded-full flex items-center justify-center mb-6">
                                <Shield className="w-10 h-10 text-primary-container" />
                            </div>
                            <h3 className="text-2xl font-bold font-serif text-ink mb-2">No Guardians Yet</h3>
                            <p className="text-ink-muted">Add your first trusted contact using the form.</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {guardians.map((guardian) => (
                                <div key={guardian._id || guardian.id} className="bg-card rounded-3xl p-6 shadow-sm border border-line group relative hover:border-primary-container/30 hover:shadow-md transition-all">
                                    <div className="flex items-start justify-between">
                                        <div className="flex items-center gap-4">
                                            <div className={`w-14 h-14 rounded-full ${getAvatarColor(guardian.relationship)} flex items-center justify-center text-white font-black text-xl shadow-inner`}>
                                                {getInitials(guardian.guardianName)}
                                            </div>
                                            <div>
                                                <h4 className="font-bold text-lg text-ink">{guardian.guardianName}</h4>
                                                <p className="text-xs font-bold text-ink-muted uppercase tracking-wider mt-0.5">{guardian.relationship}</p>
                                            </div>
                                        </div>
                                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity bg-card shadow-sm border border-line rounded-lg p-1 absolute top-6 right-6">
                                            <button
                                                onClick={() => setEditingGuardian(guardian)}
                                                className="p-2 text-ink-muted hover:text-primary-container hover:bg-canvas rounded-md transition-colors"
                                                title="Edit"
                                            >
                                                <Edit2 className="w-4 h-4" />
                                            </button>
                                            <button
                                                onClick={() => removeGuardian(guardian._id || guardian.id)}
                                                className="p-2 text-ink-muted hover:text-error hover:bg-error/10 rounded-md transition-colors"
                                                title="Remove"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </div>

                                    <div className="mt-6 space-y-4">
                                        <div className="flex items-center gap-3 text-sm text-ink font-medium bg-canvas p-3 rounded-xl">
                                            <Phone className="w-4 h-4 text-ink-muted" />
                                            <span className="flex-1 font-mono" aria-label="Trusted contact phone number">
                                                {revealedPhones[guardian._id || guardian.id]
                                                    ? guardian.guardianPhone
                                                    : maskPhone(guardian.guardianPhone)}
                                            </span>
                                            <button
                                                type="button"
                                                onClick={() => setRevealedPhones((current) => ({
                                                    ...current,
                                                    [guardian._id || guardian.id]: !current[guardian._id || guardian.id],
                                                }))}
                                                className="rounded-md p-1.5 text-ink-muted hover:bg-card hover:text-primary"
                                                aria-label={revealedPhones[guardian._id || guardian.id] ? 'Hide phone number' : 'Show phone number'}
                                            >
                                                {revealedPhones[guardian._id || guardian.id]
                                                    ? <EyeOff className="h-4 w-4" />
                                                    : <Eye className="h-4 w-4" />}
                                            </button>
                                        </div>

                                        <div className="flex items-center justify-between px-1">
                                            {guardian.isVerified ? (
                                                <span className="flex items-center gap-2 text-success font-bold text-sm">
                                                    <CheckCircle className="w-4 h-4" /> Verified
                                                </span>
                                            ) : (
                                                <VerificationButton guardian={guardian} onVerify={handleVerifySuccess} />
                                            )}
                                        </div>

                                        {guardian.isVerified && (
                                            <button
                                                onClick={() => handleTestAlert(guardian)}
                                                className="w-full py-2.5 bg-primary-container/5 hover:bg-primary-container/10 text-primary-container rounded-xl font-bold text-xs uppercase tracking-widest flex items-center justify-center gap-2 transition-colors mt-2"
                                            >
                                                <Shield className="w-4 h-4" /> Send Test Alert
                                            </button>
                                        )}
                                    </div>
                                    <div className="mt-5 pt-4 border-t border-line flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-ink-muted">
                                        <span>Last Alert:</span>
                                        <span className={guardian.lastAlert === 'Never' ? 'text-ink-muted' : 'text-primary-container'}>{guardian.lastAlert}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                    <div className="p-8 rounded-3xl bg-info/5 border-2 border-dashed border-info/20 mt-8">
                        <div className="flex items-start gap-4">
                            <Shield className="w-8 h-8 text-info mt-1" />
                            <div>
                                <h4 className="text-lg font-bold text-ink mb-1">Safety Verification Status</h4>
                                <p className="text-sm text-ink-muted leading-relaxed">Ensure all guardians have verified their phone numbers to receive real-time SOS alerts via SMS. Unverified guardians will only receive in-app push notifications.</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}