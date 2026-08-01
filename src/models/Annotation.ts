import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IPosition {
    x: number;
    y: number;
    width?: number;
    height?: number;
}

export interface IAnnotation extends Document {
    page: mongoose.Types.ObjectId;
    annotatedBy: mongoose.Types.ObjectId;
    comment: string;
    position?: IPosition;
    createdAt: Date;
    updatedAt: Date;
}

const PositionSchema = new Schema<IPosition>(
    {
        x: { type: Number, required: true },
        y: { type: Number, required: true },
        width: { type: Number },
        height: { type: Number }
    },
    { _id: false }
);

const AnnotationSchema = new Schema<IAnnotation>(
    {
        page: {
            type: Schema.Types.ObjectId,
            ref: 'Page',
            required: true,
            index: true
        },
        annotatedBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true
        },
        comment: {
            type: String,
            required: true,
            trim: true
        },
        position: PositionSchema
    },
    {
        timestamps: true
    }
);

const Annotation: Model<IAnnotation> = mongoose.models.Annotation || mongoose.model<IAnnotation>('Annotation', AnnotationSchema);

export default Annotation;
