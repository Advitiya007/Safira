import React from 'react';
import FormInput from '../Auth/FormInput';

export default function UPIForm() {
    return (
        <div className="space-y-4">
            <div className="bg-canvas border border-line rounded-lg p-4 mb-4 text-center">
                <span className="material-symbols-outlined text-4xl text-ink-muted mb-2">qr_code_2</span>
                <p className="font-body text-sm text-on-surface-variant">Scan QR or enter UPI ID below</p>
            </div>
            <FormInput id="upi" label="UPI ID" placeholder="name@upi" />
        </div>
    );
}
