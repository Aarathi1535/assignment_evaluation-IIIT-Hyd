import mongoose from 'mongoose';
import Notification, { INotification, NotificationType } from '../models/Notification';
import { HttpError } from '../lib/errors';

export interface CreateNotificationInput {
    recipient: string | mongoose.Types.ObjectId;
    type?: NotificationType;
    title: string;
    message: string;
    allocation?: string | mongoose.Types.ObjectId;
    exam?: string | mongoose.Types.ObjectId;
    answerScript?: string | mongoose.Types.ObjectId;
    question?: number | null;
}

export interface GetNotificationsOptions {
    page?: number;
    limit?: number;
    unreadOnly?: boolean;
}

export class NotificationService {
    /**
     * Creates notification(s) within a database session/transaction.
     */
    static async createNotifications(
        inputs: CreateNotificationInput[],
        session?: mongoose.ClientSession
    ): Promise<INotification[]> {
        if (!inputs || inputs.length === 0) {
            return [];
        }

        const docsToCreate = inputs.map((input) => ({
            recipient: new mongoose.Types.ObjectId(input.recipient),
            type: input.type || NotificationType.ASSIGNMENT,
            title: input.title,
            message: input.message,
            allocation: input.allocation ? new mongoose.Types.ObjectId(input.allocation) : undefined,
            exam: input.exam ? new mongoose.Types.ObjectId(input.exam) : undefined,
            answerScript: input.answerScript ? new mongoose.Types.ObjectId(input.answerScript) : undefined,
            question: input.question !== null && input.question !== undefined ? input.question : undefined,
            read: false
        }));

        return await Notification.create(docsToCreate, { session });
    }

    /**
     * Returns the count of unread notifications for a user.
     */
    static async getUnreadCount(userId: string): Promise<number> {
        if (!mongoose.Types.ObjectId.isValid(userId)) {
            throw new HttpError('Invalid User ID format', 400);
        }

        const count = await Notification.countDocuments({
            recipient: new mongoose.Types.ObjectId(userId),
            read: false
        });

        return count;
    }

    /**
     * Retrieves paginated notifications for a specific user.
     */
    static async getUserNotifications(
        userId: string,
        options: GetNotificationsOptions = {}
    ): Promise<{
        notifications: INotification[];
        unreadCount: number;
        total: number;
        page: number;
        totalPages: number;
    }> {
        if (!mongoose.Types.ObjectId.isValid(userId)) {
            throw new HttpError('Invalid User ID format', 400);
        }

        const userObjectId = new mongoose.Types.ObjectId(userId);
        const page = Math.max(1, options.page || 1);
        const limit = Math.min(100, Math.max(1, options.limit || 20));
        const skip = (page - 1) * limit;

        const query: { recipient: mongoose.Types.ObjectId; read?: boolean } = {
            recipient: userObjectId
        };

        if (options.unreadOnly) {
            query.read = false;
        }

        const [notifications, total, unreadCount] = await Promise.all([
            Notification.find(query)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .populate('exam', 'title')
                .populate('answerScript', 'anonymousId scriptReference')
                .lean(),
            Notification.countDocuments(query),
            Notification.countDocuments({ recipient: userObjectId, read: false })
        ]);

        const totalPages = Math.ceil(total / limit);

        return {
            notifications: notifications as unknown as INotification[],
            unreadCount,
            total,
            page,
            totalPages
        };
    }

    /**
     * Marks a specific notification as read for the authenticated user.
     * Enforces that the notification belongs to the calling user.
     */
    static async markAsRead(notificationId: string, userId: string): Promise<INotification> {
        if (!mongoose.Types.ObjectId.isValid(notificationId)) {
            throw new HttpError('Invalid Notification ID format', 400);
        }
        if (!mongoose.Types.ObjectId.isValid(userId)) {
            throw new HttpError('Invalid User ID format', 400);
        }

        const notificationObjectId = new mongoose.Types.ObjectId(notificationId);
        const userObjectId = new mongoose.Types.ObjectId(userId);

        const notification = await Notification.findOne({
            _id: notificationObjectId
        });

        if (!notification) {
            throw new HttpError('Notification not found', 404);
        }

        if (notification.recipient.toString() !== userObjectId.toString()) {
            throw new HttpError('Forbidden: Cannot mark another user\'s notification as read', 403);
        }

        if (!notification.read) {
            notification.read = true;
            notification.readAt = new Date();
            await notification.save();
        }

        return notification;
    }

    /**
     * Marks all notifications as read for a user.
     */
    static async markAllAsRead(userId: string): Promise<{ modifiedCount: number }> {
        if (!mongoose.Types.ObjectId.isValid(userId)) {
            throw new HttpError('Invalid User ID format', 400);
        }

        const userObjectId = new mongoose.Types.ObjectId(userId);

        const result = await Notification.updateMany(
            { recipient: userObjectId, read: false },
            { $set: { read: true, readAt: new Date() } }
        );

        return { modifiedCount: result.modifiedCount };
    }
}

export default NotificationService;
