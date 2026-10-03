import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
    PersonalizedEnrollmentCard,
    ScheduleInfo,
    StatsSummary
} from '../app/(dashboard)/student/personalized/page';

describe('Student personalized assessment enrollment summary', () => {
    it('shows the enrolled course, status, progress, and today assessment status', () => {
        const schedule: ScheduleInfo = {
            _id: 'schedule-1',
            title: 'Fall Personalized Assessment',
            totalQuestionsTarget: 100,
            totalWeeks: 16,
            dailyWindowStartTime: '09:00',
            dailyWindowEndTime: '22:00',
            course: {
                courseCode: 'CS7.501',
                courseName: 'Advanced Computer Vision'
            }
        };
        const stats: StatsSummary = {
            total: 10,
            completed: 0,
            missed: 0,
            locked: 100,
            inProgress: 0,
            streak: 0,
            completionPercentage: 0
        };

        const html = renderToStaticMarkup(
            React.createElement(PersonalizedEnrollmentCard, {
                schedule,
                stats,
                todayStatus: 'Available'
            })
        );

        expect(html).toContain('Personalized Assessment Enrollment');
        expect(html).toContain('Advanced Computer Vision (CS7.501)');
        expect(html).toContain('Enrollment status');
        expect(html).toContain('Enrolled');
        expect(html).toContain('Assessment progress');
        expect(html).toContain('0 / 100');
        expect(html).toContain('Today&#x27;s assessment');
        expect(html).toContain('Available');
    });

    it('uses the configured target when progress data has no assignment total', () => {
        const schedule: ScheduleInfo = {
            _id: 'schedule-2',
            title: 'Spring Personalized Assessment',
            totalQuestionsTarget: 100,
            totalWeeks: 16,
            dailyWindowStartTime: '09:00',
            dailyWindowEndTime: '22:00',
            course: {
                courseCode: 'CS7.502',
                courseName: 'Machine Learning'
            }
        };

        const html = renderToStaticMarkup(
            React.createElement(PersonalizedEnrollmentCard, {
                schedule,
                stats: null,
                todayStatus: 'No assessment scheduled today'
            })
        );

        expect(html).toContain('0 / 100');
        expect(html).toContain('No assessment scheduled today');
    });
});
