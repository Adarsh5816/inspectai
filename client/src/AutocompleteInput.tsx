import React, { useState, useEffect, useRef, useMemo } from 'react';
import * as API from './api';

export interface AutocompleteInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  category: 'customer' | 'supplier' | 'location';
  placeholder?: string;
  required?: boolean;
  className?: string;
  helperText?: string;
}

// Global in-memory cache to share suggestions across all active inputs
const suggestionsCache: Record<string, string[]> = {
  customer: [],
  supplier: [],
  location: [],
};

const defaultFallbacks: Record<string, string[]> = {
  customer: [
    'ADNOC Onshore',
    'ADNOC Offshore',
    'ADNOC Gas',
    'Saudi Aramco',
    'Kuwait Oil Company (KOC)',
    'Petroleum Development Oman (PDO)',
    'QatarEnergy',
    'TOTAL Energies',
    'BP',
    'Shell',
  ],
  supplier: [
    'KSB MIL Controls Limited',
    'Flowserve Sanmar Limited',
    'Emerson Fisher Process Automation',
    'Cameron (Schlumberger)',
    'Baker Hughes',
    'Weir Valves & Controls',
    'Valmet / Neles',
    'Specialised Coating Services',
  ],
  location: [
    'Meladoor, Kerala, India',
    'Meladoor, Annamanada, Kerala',
    'Coimbatore, Tamil Nadu, India',
    'Chennai, Tamil Nadu, India',
    'Abu Dhabi, UAE',
    'Mussafah, Abu Dhabi, UAE',
    'Dubai, UAE',
    'Dammam, Saudi Arabia',
    'Jubail, Saudi Arabia',
    'Doha, Qatar',
  ],
};

/**
 * Register a newly entered value so it immediately shows in the auto dropdown
 */
export function registerNewSuggestion(category: 'customer' | 'supplier' | 'location', value: string) {
  const trimmed = (value || '').trim();
  if (!trimmed) return;

  const cat = category.toLowerCase() as 'customer' | 'supplier' | 'location';
  const current = suggestionsCache[cat] || [];
  if (!current.some(c => c.toLowerCase() === trimmed.toLowerCase())) {
    const updated = [trimmed, ...current];
    suggestionsCache[cat] = updated;
    try {
      localStorage.setItem(`inspectai_suggestions_${cat}`, JSON.stringify(updated));
    } catch {}
    window.dispatchEvent(new CustomEvent('inspectai-suggestion-added', { detail: { category: cat, value: trimmed } }));
    API.addSuggestion(cat, trimmed).catch(() => {});
  }
}

export default function AutocompleteInput({
  label,
  value,
  onChange,
  category,
  placeholder,
  required,
  className = '',
  helperText,
}: AutocompleteInputProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [suggestions, setSuggestions] = useState<string[]>(() => {
    // 1. Try in-memory
    if (suggestionsCache[category]?.length > 0) {
      return suggestionsCache[category];
    }
    // 2. Try localStorage
    try {
      const stored = localStorage.getItem(`inspectai_suggestions_${category}`);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          suggestionsCache[category] = parsed;
          return parsed;
        }
      }
    } catch {}
    // 3. Fallback defaults
    return defaultFallbacks[category] || [];
  });

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Fetch suggestions from backend on mount
  useEffect(() => {
    let isMounted = true;
    const loadSuggestions = async () => {
      try {
        const res = await API.getSuggestions();
        if (res.data && isMounted) {
          const key = category === 'customer' ? 'customers' : category === 'supplier' ? 'suppliers' : 'locations';
          const list = res.data[key] || [];
          if (Array.isArray(list) && list.length > 0) {
            suggestionsCache[category] = list;
            setSuggestions(list);
            try {
              localStorage.setItem(`inspectai_suggestions_${category}`, JSON.stringify(list));
            } catch {}
          }
        }
      } catch (err) {
        // Fallback to cache/defaults silently
      }
    };

    loadSuggestions();

    // Listen for new suggestions added elsewhere in app
    const handleNewSuggestion = (e: any) => {
      if (e.detail?.category === category) {
        const newVal = e.detail.value;
        setSuggestions(prev => {
          if (prev.some(p => p.toLowerCase() === newVal.toLowerCase())) return prev;
          return [newVal, ...prev];
        });
      }
    };

    window.addEventListener('inspectai-suggestion-added', handleNewSuggestion);
    return () => {
      isMounted = false;
      window.removeEventListener('inspectai-suggestion-added', handleNewSuggestion);
    };
  }, [category]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Filter suggestions based on input value
  const query = (value || '').trim().toLowerCase();
  const filteredSuggestions = useMemo(() => {
    if (!query) return suggestions;
    return suggestions.filter(s => s.toLowerCase().includes(query));
  }, [suggestions, query]);

  // Is current typed value already in suggestions?
  const isExactMatch = useMemo(() => {
    if (!query) return true;
    return suggestions.some(s => s.toLowerCase() === query);
  }, [suggestions, query]);

  const handleSelect = (item: string) => {
    onChange(item);
    registerNewSuggestion(category, item);
    setIsOpen(false);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      setIsOpen(true);
      return;
    }

    const totalItems = filteredSuggestions.length + (!isExactMatch && query ? 1 : 0);

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex(prev => (prev < totalItems - 1 ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex(prev => (prev > 0 ? prev - 1 : totalItems - 1));
    } else if (e.key === 'Enter') {
      if (isOpen && highlightedIndex >= 0) {
        e.preventDefault();
        if (!isExactMatch && query && highlightedIndex === 0) {
          handleSelect(value.trim());
        } else {
          const targetItem = !isExactMatch && query
            ? filteredSuggestions[highlightedIndex - 1]
            : filteredSuggestions[highlightedIndex];
          if (targetItem) handleSelect(targetItem);
        }
      } else {
        // Remember value on enter
        if (value.trim()) registerNewSuggestion(category, value.trim());
        setIsOpen(false);
      }
    } else if (e.key === 'Escape') {
      setIsOpen(false);
    }
  };

  const handleBlur = () => {
    // If a value was entered, register it automatically so next time it shows in dropdown
    if (value && value.trim()) {
      registerNewSuggestion(category, value.trim());
    }
  };

  const getCategoryIcon = () => {
    if (category === 'customer') return '🏢';
    if (category === 'supplier') return '🏭';
    return '📍';
  };

  return (
    <div className={`relative ${className}`} ref={containerRef}>
      <label className="block text-sm font-medium text-slate-700 mb-1 flex items-center justify-between">
        <span>{label}</span>
        {suggestions.length > 0 && (
          <span className="text-[10px] font-normal text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-full border border-blue-100 flex items-center gap-1" title="Previously entered items available in auto dropdown">
            <span>⚡ Auto Dropdown</span>
          </span>
        )}
      </label>

      <div className="relative flex items-center">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={e => {
            onChange(e.target.value);
            setIsOpen(true);
            setHighlightedIndex(-1);
          }}
          onFocus={() => {
            setIsOpen(true);
            setHighlightedIndex(-1);
          }}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          required={required}
          className="w-full pl-3 pr-16 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition shadow-2xs"
          autoComplete="off"
        />

        <div className="absolute right-1 flex items-center gap-1 text-slate-400">
          {value && (
            <button
              type="button"
              onClick={() => {
                onChange('');
                setIsOpen(true);
                inputRef.current?.focus();
              }}
              tabIndex={-1}
              className="p-1 hover:text-slate-600 rounded text-xs hover:bg-slate-100"
              title="Clear"
            >
              ✕
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              setIsOpen(prev => !prev);
              inputRef.current?.focus();
            }}
            tabIndex={-1}
            className="p-1.5 hover:text-blue-600 rounded hover:bg-slate-100 text-slate-400 transition"
            title="Toggle previous list"
          >
            <svg
              className={`w-4 h-4 transition-transform duration-200 ${isOpen ? 'rotate-180 text-blue-600' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>
      </div>

      {helperText && <p className="text-xs text-slate-500 mt-1">{helperText}</p>}

      {/* Floating Auto Dropdown Menu */}
      {isOpen && (
        <div className="absolute left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-2xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150">
          <div className="px-3 py-1.5 bg-slate-50 border-b border-slate-100 flex items-center justify-between text-xs text-slate-500 font-medium">
            <span className="flex items-center gap-1.5">
              <span>{getCategoryIcon()}</span>
              <span>Previous {category.charAt(0).toUpperCase() + category.slice(1)}s</span>
            </span>
            <span className="text-[11px] text-slate-400">
              {filteredSuggestions.length} found
            </span>
          </div>

          <ul ref={listRef} className="max-h-56 overflow-y-auto divide-y divide-slate-100/60 p-1 text-sm">
            {/* If user typed a new value not in the list, offer to use & save it */}
            {!isExactMatch && query && (
              <li
                onMouseDown={e => {
                  e.preventDefault();
                  handleSelect(value.trim());
                }}
                className={`px-3 py-2 rounded-lg cursor-pointer flex items-center justify-between gap-2 text-sm transition ${
                  highlightedIndex === 0 ? 'bg-blue-50 text-blue-700 font-medium' : 'text-blue-600 hover:bg-blue-50/70'
                }`}
              >
                <div className="flex items-center gap-2 truncate">
                  <span className="text-blue-500 font-bold text-base leading-none">➕</span>
                  <span className="truncate">Use & Save new: <strong className="text-slate-800 underline decoration-blue-400">{value.trim()}</strong></span>
                </div>
                <span className="text-[10px] bg-blue-100 text-blue-800 font-semibold px-2 py-0.5 rounded-full shrink-0">
                  New
                </span>
              </li>
            )}

            {filteredSuggestions.length === 0 && isExactMatch && (
              <li className="px-3 py-3 text-center text-xs text-slate-400">
                No previous {category} entries.
              </li>
            )}

            {filteredSuggestions.map((item, idx) => {
              const itemIdx = !isExactMatch && query ? idx + 1 : idx;
              const isSelected = item.toLowerCase() === (value || '').trim().toLowerCase();
              const isHighlighted = highlightedIndex === itemIdx;

              return (
                <li
                  key={item}
                  onMouseDown={e => {
                    e.preventDefault();
                    handleSelect(item);
                  }}
                  className={`px-3 py-2 rounded-lg cursor-pointer flex items-center justify-between text-sm transition ${
                    isHighlighted
                      ? 'bg-blue-50 text-blue-900 font-medium'
                      : isSelected
                      ? 'bg-slate-100 font-semibold text-slate-900'
                      : 'text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center gap-2 truncate">
                    <span className="text-slate-400 text-xs shrink-0">{getCategoryIcon()}</span>
                    <span className="truncate">{item}</span>
                  </div>

                  {isSelected && (
                    <span className="text-blue-600 text-xs font-bold shrink-0 ml-2">
                      ✓ Current
                    </span>
                  )}
                </li>
              );
            })}
          </ul>

          <div className="px-3 py-1 bg-slate-50/80 border-t border-slate-100 text-[11px] text-slate-400 flex items-center justify-between">
            <span>Type to filter or pick an item</span>
            <span>Esc to close</span>
          </div>
        </div>
      )}
    </div>
  );
}
