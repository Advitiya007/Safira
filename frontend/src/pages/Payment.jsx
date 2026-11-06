import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import UPIForm from '../components/Payment/UPIForm';
import CardForm from '../components/Payment/CardForm';
import SecurityBadges from '../components/Payment/SecurityBadges';
import Button from '../components/Common/Button';

export default function Payment() {
  const [method, setMethod] = useState('upi');
  const navigate = useNavigate();

  const handlePayment = (e) => {
    e.preventDefault();
    alert('Payment Successful!');
    navigate('/dashboard');
  };

  return (
    <div className="flex-1 bg-background flex items-center justify-center py-12 px-4">
      <div className="w-full max-w-lg bg-card rounded-xl shadow-lg border border-line overflow-hidden">

        {/* Header */}
        <div className="bg-primary-container text-white p-6 text-center">
          <h1 className="font-serif text-2xl font-bold mb-1">Upgrade to Premium</h1>
          <p className="font-body text-white/80 text-sm">Secure checkout</p>
        </div>

        {/* Order Summary */}
        <div className="p-6 border-b border-line bg-canvas flex justify-between items-center">
          <div>
            <p className="font-serif font-bold text-on-surface">Premium Guardian Plan</p>
            <p className="font-body text-xs text-on-surface-variant">Billed Monthly</p>
          </div>
          <p className="font-serif font-bold text-2xl text-primary">₹199</p>
        </div>

        {/* Payment Methods */}
        <div className="p-6">
          <div className="flex gap-2 mb-6 bg-soft p-1 rounded-lg">
            <button
              type="button"
              className={`flex-1 py-2 font-semibold text-sm rounded-md transition ${method === 'upi' ? 'bg-card text-primary shadow-sm' : 'text-ink-muted hover:text-ink-muted'}`}
              onClick={() => setMethod('upi')}
            >
              UPI
            </button>
            <button
              type="button"
              className={`flex-1 py-2 font-semibold text-sm rounded-md transition ${method === 'card' ? 'bg-card text-primary shadow-sm' : 'text-ink-muted hover:text-ink-muted'}`}
              onClick={() => setMethod('card')}
            >
              Card
            </button>
          </div>

          <form onSubmit={handlePayment}>
            {method === 'upi' ? <UPIForm /> : <CardForm />}

            <Button type="submit" variant="primary" className="w-full mt-6 flex justify-center items-center shadow-md">
              <span className="material-symbols-outlined mr-2 text-[18px]">lock</span>
              Pay Securely
            </Button>
          </form>

          <SecurityBadges />
        </div>
      </div>
    </div>
  );
}
