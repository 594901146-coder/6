import React from 'react';

interface ProgressBarProps {
  progress: number; // 0 to 100
  label?: string;
  subLabel?: string;
  colorClass?: string;
  heightClass?: string;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({ 
  progress, 
  label, 
  subLabel,
  colorClass = "bg-emerald-500",
  heightClass = "h-3"
}) => {
  return (
    <div className="w-full">
      {(label || subLabel) && (
        <div className="flex justify-between mb-1">
          {label && <span className="text-base font-medium text-white">{label}</span>}
          {subLabel && <span className="text-sm font-medium text-slate-400">{subLabel}</span>}
        </div>
      )}
      <div className="w-full bg-slate-700/50 rounded-full overflow-hidden h-3">
        <div 
          className={`${colorClass} h-full rounded-full transition-all duration-300 ease-out`} 
          style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
        >
          {progress < 100 && (
            <div className="w-full h-full opacity-30 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9InAiIHdpZHRoPSIyMCIgaGVpZ2h0PSIyMCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHBhdGggZD0iTTAgMjBMMjAgMEgwTTAgMEwyMCAyMFoiIGZpbGw9IiNmZmYiIGZpbGwtb3BhY2l0eT0iMC4xIi8+PC9wYXR0ZXJuPjwvZGVmcz48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSJ1cmwoI3ApIi8+PC9zdmc+')] animate-[shimmer_1s_linear_infinite]"></div>
          )}
        </div>
      </div>
    </div>
  );
};