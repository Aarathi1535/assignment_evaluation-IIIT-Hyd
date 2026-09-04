'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Bell, X, CheckCheck, Check, Clock, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

export interface NotificationItem {
  _id: string;
  type: string;
  title: string;
  message: string;
  allocation?: string;
  exam?: { _id: string; title: string } | string;
  answerScript?: { _id: string; anonymousId?: string; scriptReference?: string } | string;
  question?: number;
  read: boolean;
  readAt?: string;
  createdAt: string;
}

export interface NotificationPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onNotificationsUpdated?: (unreadCount: number) => void;
}

export default function NotificationPanel({
  isOpen,
  onClose,
  onNotificationsUpdated,
}: NotificationPanelProps) {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [markingId, setMarkingId] = useState<string | null>(null);
  const [isMarkingAll, setIsMarkingAll] = useState(false);

  const fetchNotifications = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/notifications?page=1&limit=30');
      const json = await res.json();
      if (res.ok && json.success) {
        setNotifications(json.data.notifications || []);
        const count = json.data.unreadCount || 0;
        setUnreadCount(count);
        onNotificationsUpdated?.(count);
      } else {
        setError(json.message || 'Failed to load notifications');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An error occurred while fetching notifications.');
    } finally {
      setIsLoading(false);
    }
  }, [onNotificationsUpdated]);

  useEffect(() => {
    if (isOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      fetchNotifications();
    }
  }, [isOpen, fetchNotifications]);

  // Keyboard accessibility: Dismiss modal on Escape key press (WCAG 2.1.2)
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const handleMarkAsRead = async (notificationId: string) => {
    setMarkingId(notificationId);
    try {
      const res = await fetch(`/api/notifications/${notificationId}/read`, {
        method: 'PATCH',
      });
      const json = await res.json();
      if (res.ok && json.success) {
        setNotifications((prev) =>
          prev.map((n) => (n._id === notificationId ? { ...n, read: true, readAt: new Date().toISOString() } : n))
        );
        const newUnread = Math.max(0, unreadCount - 1);
        setUnreadCount(newUnread);
        onNotificationsUpdated?.(newUnread);
      } else {
        setError(json.message || 'Failed to mark notification as read');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to mark as read');
    } finally {
      setMarkingId(null);
    }
  };

  const handleMarkAllAsRead = async () => {
    setIsMarkingAll(true);
    try {
      const res = await fetch('/api/notifications/read-all', {
        method: 'PATCH',
      });
      const json = await res.json();
      if (res.ok && json.success) {
        setNotifications((prev) =>
          prev.map((n) => ({ ...n, read: true, readAt: new Date().toISOString() }))
        );
        setUnreadCount(0);
        onNotificationsUpdated?.(0);
      } else {
        setError(json.message || 'Failed to mark all notifications as read');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to mark all as read');
    } finally {
      setIsMarkingAll(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-50 p-4 font-sans"
      data-testid="notification-panel-backdrop"
    >
      <div
        className="bg-white rounded-brand-lg max-w-lg w-full border border-slate-200 shadow-xl overflow-hidden relative flex flex-col max-h-[85vh] animate-in fade-in zoom-in-95 duration-200"
        role="dialog"
        aria-modal="true"
        aria-labelledby="notifications-panel-title"
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 bg-slate-50/50 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-full bg-brand-primary/10 text-brand-primary flex items-center justify-center">
              <Bell className="h-4.5 w-4.5" />
            </div>
            <div>
              <h2 id="notifications-panel-title" className="text-base font-bold text-slate-900">
                Assignment Notifications
              </h2>
              <p className="text-xs text-slate-500 font-medium">
                {unreadCount > 0
                  ? `${unreadCount} unread notification${unreadCount === 1 ? '' : 's'}`
                  : 'All notifications are up to date'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleMarkAllAsRead}
                isLoading={isMarkingAll}
                className="text-xs py-1 px-2.5 cursor-pointer"
                data-testid="mark-all-read-btn"
              >
                <CheckCheck className="h-3.5 w-3.5 mr-1" />
                <span>Mark All Read</span>
              </Button>
            )}
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-slate-600 transition-colors p-1.5 rounded-brand hover:bg-slate-100 cursor-pointer"
              aria-label="Close dialog"
              data-testid="notification-panel-close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Error Alert */}
        {error && (
          <div
            role="alert"
            className="mx-5 mt-4 p-3 rounded-brand bg-rose-50 border border-rose-200 flex items-center gap-2 text-xs text-rose-700 font-medium"
          >
            <AlertCircle className="h-4 w-4 text-rose-600 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Notifications List Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {isLoading ? (
            <div className="py-12 flex flex-col items-center justify-center space-y-2">
              <LoadingSpinner size="md" />
              <p className="text-xs font-semibold text-slate-500">Loading notifications...</p>
            </div>
          ) : notifications.length === 0 ? (
            <div className="py-12 text-center space-y-2">
              <div className="mx-auto w-12 h-12 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center">
                <Bell className="h-6 w-6" />
              </div>
              <p className="text-sm font-bold text-slate-700">No notifications yet</p>
              <p className="text-xs text-slate-500 max-w-xs mx-auto">
                You will receive in-app notifications whenever a professor assigns or reassigns exam scripts to you.
              </p>
            </div>
          ) : (
            notifications.map((n) => {
              const examTitle = typeof n.exam === 'object' && n.exam ? n.exam.title : null;
              const scriptRef =
                typeof n.answerScript === 'object' && n.answerScript
                  ? n.answerScript.scriptReference || n.answerScript.anonymousId
                  : null;

              return (
                <div
                  key={n._id}
                  data-testid={`notification-item-${n._id}`}
                  className={`p-4 rounded-brand border transition-all ${
                    n.read
                      ? 'bg-white border-slate-200 opacity-80'
                      : 'bg-brand-primary/5 border-brand-primary/20 shadow-xs'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1 flex-1">
                      <div className="flex items-center gap-2">
                        {!n.read && (
                          <span
                            className="h-2 w-2 rounded-full bg-brand-primary shrink-0"
                            data-testid={`unread-dot-${n._id}`}
                          />
                        )}
                        <h4 className="text-sm font-bold text-slate-900">{n.title}</h4>
                      </div>
                      <p className="text-xs text-slate-600 leading-relaxed">{n.message}</p>

                      {(examTitle || scriptRef || n.question) && (
                        <div className="flex flex-wrap gap-2 pt-1.5 text-4xs font-semibold text-slate-500">
                          {examTitle && (
                            <span className="bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                              Exam: {examTitle}
                            </span>
                          )}
                          {scriptRef && (
                            <span className="bg-slate-100 px-2 py-0.5 rounded border border-slate-200 font-mono">
                              Script: {scriptRef}
                            </span>
                          )}
                          {n.question !== undefined && n.question !== null && (
                            <span className="bg-purple-50 text-purple-700 px-2 py-0.5 rounded border border-purple-200">
                              Question {n.question}
                            </span>
                          )}
                        </div>
                      )}

                      <div className="flex items-center gap-1.5 text-4xs text-slate-400 pt-1 font-medium">
                        <Clock className="h-3 w-3" />
                        <span>{new Date(n.createdAt).toLocaleString()}</span>
                      </div>
                    </div>

                    {!n.read && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => handleMarkAsRead(n._id)}
                        isLoading={markingId === n._id}
                        disabled={markingId === n._id}
                        className="text-2xs py-1 px-2 text-brand-primary border-brand-primary/30 hover:bg-brand-primary/10 shrink-0 cursor-pointer"
                        data-testid={`mark-read-btn-${n._id}`}
                      >
                        <Check className="h-3 w-3 mr-1" />
                        <span>Mark read</span>
                      </Button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex justify-end">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
