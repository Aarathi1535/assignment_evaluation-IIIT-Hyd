import { useEffect, useRef } from 'react';

export interface UseDialogFocusOptions {
  isOpen: boolean;
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  containerRef?: React.RefObject<HTMLElement | null>;
  returnFocusRef?: React.RefObject<HTMLElement | null>;
  onClose?: () => void;
  disableEscape?: boolean;
}

/**
 * Reusable dialog focus management hook (WCAG 2.1 - 2.4.3 Focus Order, 2.1.2 No Keyboard Trap).
 * - On open: captures the active trigger element and moves focus into the dialog (initialFocusRef, containerRef, or first focusable element).
 * - On close: safely returns focus to the captured trigger element if it still exists and is focusable.
 * - Handles Escape key to close if onClose is provided.
 */
export function useDialogFocus({
  isOpen,
  initialFocusRef,
  containerRef,
  returnFocusRef,
  onClose,
  disableEscape = false,
}: UseDialogFocusOptions) {
  const triggerElementRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      // 1. Capture the currently focused element as the trigger
      if (typeof document !== 'undefined') {
        const active = (returnFocusRef?.current || document.activeElement) as HTMLElement | null;
        if (active && typeof active.focus === 'function') {
          triggerElementRef.current = active;
        }
      }

      // 2. Move focus into the dialog after mount
      const focusTarget = () => {
        if (initialFocusRef?.current && typeof initialFocusRef.current.focus === 'function') {
          initialFocusRef.current.focus();
          return;
        }

        if (containerRef?.current) {
          // Find first focusable element inside the container
          const focusable = containerRef.current.querySelector<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
          );
          if (focusable && typeof focusable.focus === 'function') {
            focusable.focus();
            return;
          }

          // Fallback to the container itself if focusable
          if (typeof containerRef.current.focus === 'function') {
            containerRef.current.focus();
          }
        }
      };

      const frameId = typeof requestAnimationFrame !== 'undefined'
        ? requestAnimationFrame(focusTarget)
        : null;

      if (frameId === null) {
        focusTarget();
      }

      return () => {
        if (frameId !== null && typeof cancelAnimationFrame !== 'undefined') {
          cancelAnimationFrame(frameId);
        }
      };
    } else {
      // Dialog closed: return focus to trigger
      if (triggerElementRef.current && typeof triggerElementRef.current.focus === 'function') {
        try {
          if (typeof document !== 'undefined' && document.body.contains(triggerElementRef.current)) {
            triggerElementRef.current.focus();
          }
        } catch {
          // Gracefully ignore if element is no longer focusable
        }
        triggerElementRef.current = null;
      }
    }
  }, [isOpen, initialFocusRef, containerRef, returnFocusRef]);

  // Clean up and return focus on component unmount if unmounted while open
  useEffect(() => {
    return () => {
      if (triggerElementRef.current && typeof triggerElementRef.current.focus === 'function') {
        try {
          if (typeof document !== 'undefined' && document.body.contains(triggerElementRef.current)) {
            triggerElementRef.current.focus();
          }
        } catch {
          // Gracefully ignore
        }
      }
    };
  }, []);

  // Keyboard accessibility: Escape key listener
  useEffect(() => {
    if (!isOpen || disableEscape || !onClose) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, disableEscape, onClose]);

  return { triggerElementRef };
}

export default useDialogFocus;
