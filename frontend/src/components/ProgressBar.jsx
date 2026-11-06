import React from 'react';

const ProgressBar = ({ currentStep }) => {
  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center">
          <div className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-semibold ${
            currentStep >= 1 
              ? 'bg-primary-container text-white'
              : 'bg-soft text-ink-muted'
          }`}>
            1
          </div>
          <span className={`ml-2 text-sm font-semibold ${
            currentStep >= 1 ? 'text-primary-container' : 'text-ink-muted'
          }`}>
            Essential Details
          </span>
        </div>
        
        <div className="flex-1 mx-4">
          <div className="h-1 bg-soft rounded-full overflow-hidden">
            <div 
              className={`h-full bg-primary-container transition-all duration-300 ${
                currentStep === 1 ? 'w-1/2' : 'w-full'
              }`}
            />
          </div>
        </div>
        
        <div className="flex items-center">
          <div className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-semibold ${
            currentStep >= 2 
              ? 'bg-primary-container text-white'
              : 'bg-soft text-ink-muted'
          }`}>
            2
          </div>
          <span className={`ml-2 text-sm font-semibold ${
            currentStep >= 2 ? 'text-primary-container' : 'text-ink-muted'
          }`}>
            Emergency Contact
          </span>
        </div>
      </div>
      
      <div className="text-center">
        <span className="text-sm text-primary-container font-medium">
          Step {currentStep} of 2 → {currentStep === 1 ? 'Essential Details' : 'Emergency Contact'}
        </span>
      </div>
    </div>
  );
};

export default ProgressBar;
