import mongoose, { Schema, Document, Model } from 'mongoose';

export enum FlagStatus {
    OPEN = 'OPEN',
    RESOLVED = 'RESOLVED',
    ESCALATED = 'ESCALATED'
}

export enum FlagReason {
    CHEATING_SUSPECTED = 'CHEATING_SUSPECTED',
    ILLEGIBLE = 'ILLEGIBLE',
    OTHER = 'OTHER'
}

export enum FlagResolutionAction {
    OVERRIDE = 'OVERRIDE',
    CLEAR = 'CLEAR',
    ESCALATE = 'ESCALATE'
}

export interface ICriterionOverride {
    criterionName: string;
    score: number;
    feedback?: string;
}

export interface IScriptFlagResolution {
    action?: FlagResolutionAction | string;
    by?: mongoose.Types.ObjectId;
    at?: Date;
    notes?: string;
    previousScore?: number;
    newScore?: number;
    criterionOverrides?: ICriterionOverride[];
}

export interface IScriptFlag extends Document {
    answerScript: mongoose.Types.ObjectId;
    exam: mongoose.Types.ObjectId;
    question?: number;
    raisedBy: mongoose.Types.ObjectId;
    reason: FlagReason;
    note?: string;
    status: FlagStatus;
    resolution?: IScriptFlagResolution | null;
    createdAt: Date;
    updatedAt: Date;
}

const CriterionOverrideSchema = new Schema<ICriterionOverride>(
    {
        criterionName: {
            type: String,
            required: true,
            trim: true
        },
        score: {
            type: Number,
            required: true,
            min: 0
        },
        feedback: {
            type: String,
            trim: true
        }
    },
    { _id: false }
);

const ScriptFlagResolutionSchema = new Schema<IScriptFlagResolution>(
    {
        action: {
            type: String,
            enum: Object.values(FlagResolutionAction),
            required: true,
            trim: true
        },
        by: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true
        },
        at: {
            type: Date,
            required: true,
            default: Date.now
        },
        notes: {
            type: String,
            required: true,
            trim: true,
            maxlength: 2000
        },
        previousScore: {
            type: Number
        },
        newScore: {
            type: Number
        },
        criterionOverrides: [CriterionOverrideSchema]
    },
    { _id: false }
);

const ScriptFlagSchema = new Schema<IScriptFlag>(
    {
        answerScript: {
            type: Schema.Types.ObjectId,
            ref: 'AnswerScript',
            required: true,
            index: true
        },
        exam: {
            type: Schema.Types.ObjectId,
            ref: 'Exam',
            required: true,
            index: true
        },
        question: {
            type: Number,
            required: false,
            min: 1
        },
        raisedBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true
        },
        reason: {
            type: String,
            enum: Object.values(FlagReason),
            required: true,
            index: true
        },
        note: {
            type: String,
            trim: true,
            maxlength: 2000
        },
        status: {
            type: String,
            enum: Object.values(FlagStatus),
            default: FlagStatus.OPEN,
            required: true,
            index: true
        },
        resolution: {
            type: ScriptFlagResolutionSchema,
            default: null
        }
    },
    {
        timestamps: true
    }
);

// Partial unique compound index: only ONE OPEN flag per (answerScript, question, raisedBy)
ScriptFlagSchema.index(
    { answerScript: 1, question: 1, raisedBy: 1 },
    {
        unique: true,
        partialFilterExpression: { status: FlagStatus.OPEN }
    }
);

// Query indexes for efficient professor queue and TA filtering
ScriptFlagSchema.index({ exam: 1, status: 1 });
ScriptFlagSchema.index({ raisedBy: 1, status: 1 });

const ScriptFlag: Model<IScriptFlag> =
    mongoose.models.ScriptFlag || mongoose.model<IScriptFlag>('ScriptFlag', ScriptFlagSchema);

export default ScriptFlag;
