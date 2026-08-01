'use client';

import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Search, Check, X } from 'lucide-react';

interface Option {
  value: string;
  label: string;
}

interface SearchableMultiSelectProps {
  label: string;
  options: Option[];
  value: string[];
  onChange: (value: string[]) => void;
  error?: string;
  placeholder?: string;
}

export const SearchableMultiSelect: React.FC<SearchableMultiSelectProps> = ({
  label,
  options,
  value = [],
  onChange,
  error,
  placeholder = 'Select options...',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  const handleSelect = (val: string) => {
    if (value.includes(val)) {
      onChange(value.filter((item) => item !== val));
    } else {
      onChange([...value, val]);
    }
  };

  const handleRemove = (val: string, e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(value.filter((item) => item !== val));
  };

  const filteredOptions = options.filter((opt) =>
    opt.label.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div ref={containerRef} className="space-y-1.5 w-full relative">
      <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">
        {label}
      </label>

      <div
        onClick={() => {
          setIsOpen(!isOpen);
          setSearch('');
        }}
        className={`min-h-[46px] w-full flex flex-wrap items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-left focus-within:ring-2 focus-within:ring-indigo-500/20 focus-within:border-indigo-500 transition-all cursor-pointer ${
          error ? 'border-rose-500 focus-within:ring-rose-500/20 focus-within:border-rose-500' : ''
        }`}
      >
        {value.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 mr-6">
            {value.map((val) => {
              const opt = options.find((o) => o.value === val);
              return (
                <span
                  key={val}
                  className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-xs font-semibold bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20"
                >
                  {opt ? opt.label : val}
                  <button
                    type="button"
                    onClick={(e) => handleRemove(val, e)}
                    className="hover:bg-indigo-500/20 rounded-md p-0.5 transition-colors cursor-pointer"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              );
            })}
          </div>
        ) : (
          <span className="text-slate-400">{placeholder}</span>
        )}
        <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
      </div>

      {isOpen && (
        <div className="absolute z-50 w-full mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg max-h-60 overflow-hidden flex flex-col">
          <div className="flex items-center px-3 py-2 border-b border-slate-100 dark:border-slate-750 bg-slate-50/50 dark:bg-slate-800">
            <Search className="h-4 w-4 text-slate-400 mr-2 shrink-0" />
            <input
              type="text"
              placeholder="Search..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-transparent text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none"
            />
          </div>
          <div className="overflow-y-auto py-1">
            {filteredOptions.length > 0 ? (
              filteredOptions.map((opt) => {
                const isSelected = value.includes(opt.value);
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => handleSelect(opt.value)}
                    className="w-full flex items-center justify-between px-4 py-2 text-sm text-left hover:bg-slate-50 dark:hover:bg-slate-750 text-slate-950 dark:text-white cursor-pointer"
                  >
                    <span>{opt.label}</span>
                    {isSelected && <Check className="h-4 w-4 text-indigo-500" />}
                  </button>
                );
              })
            ) : (
              <p className="px-4 py-2 text-xs text-slate-400 dark:text-slate-500">No options found</p>
            )}
          </div>
        </div>
      )}

      {error && (
        <p className="text-xs font-medium text-rose-500 dark:text-rose-400">
          {error}
        </p>
      )}
    </div>
  );
};
