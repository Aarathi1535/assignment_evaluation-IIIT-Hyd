import { IIngestionPage } from '../../models/IngestionPage';

export interface ScriptRange {
    fileIndex: number;
    startPageNumber: number;
    endPageNumber: number;
    pageCount: number;
    pages: IIngestionPage[];
}

export interface PageSplittingStrategy {
    split(pages: IIngestionPage[]): ScriptRange[];
}
