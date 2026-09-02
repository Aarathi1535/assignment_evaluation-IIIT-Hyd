import mongoose, { Schema, Document, Model } from 'mongoose';

export enum NotificationType {
    ASSIGNMENT = 'ASSIGNMENT'
}

export interface INotification extends Document {
    recipient: mongoose.Types.ObjectId;
    type: NotificationType;
    title: string;
    message: string;
    allocation?: mongoose.Types.ObjectId;
    exam?: mongoose.Types.ObjectId;
    answerScript?: mongoose.Types.ObjectId;
    question?: number;
    read: boolean;
    readAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}

const NotificationSchema = new Schema<INotification>(
    {
        recipient: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true
        },
        type: {
            type: String,
            enum: Object.values(NotificationType),
            default: NotificationType.ASSIGNMENT,
            required: true,
            index: true
        },
        title: {
            type: String,
            required: true,
            trim: true
        },
        message: {
            type: String,
            required: true,
            trim: true
        },
        allocation: {
            type: Schema.Types.ObjectId,
            ref: 'Allocation',
            required: false,
            index: true
        },
        exam: {
            type: Schema.Types.ObjectId,
            ref: 'Exam',
            required: false,
            index: true
        },
        answerScript: {
            type: Schema.Types.ObjectId,
            ref: 'AnswerScript',
            required: false
        },
        question: {
            type: Number,
            required: false
        },
        read: {
            type: Boolean,
            default: false,
            required: true,
            index: true
        },
        readAt: {
            type: Date,
            required: false
        }
    },
    {
        timestamps: true
    }
);

// Compound index for querying a TA's notifications sorted by read state and recency
NotificationSchema.index({ recipient: 1, read: 1, createdAt: -1 });

const Notification: Model<INotification> = mongoose.models.Notification || mongoose.model<INotification>('Notification', NotificationSchema);

export default Notification;
