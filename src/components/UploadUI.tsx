'use client';

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { 
  UploadCloud, 
  FileText, 
  AlertCircle, 
  CheckCircle2, 
  Trash2, 
  Loader2, 
  RefreshCw, 
  X,
  ArrowRight,
  ShieldAlert
} from 'lucide-react';
import { Button } from './ui/Button';
import { Card } from './ui/Card';
import { FormField } from './ui/FormField';
import { countPdfPages, validateFiles } from '@/utils/clientFileValidation';

interface ExamItem {
  _id: string;
  title: string;
  course: string;
  status: string;
}

interface CourseItem {
  _id: string;
  courseCode: string;
  courseName: string;
}

interface UploadUIProps {
  role: 'PROFESSOR' | 'ADMIN';
}

export default function UploadUI({ role }: UploadUIProps) {
  const router = useRouter();
  const [exams, setExams] = useState<ExamItem[]>([]);
  const [courses, setCourses] = useState<CourseItem[]>([]);
  const [loadingExams, setLoadingExams] = useState(true);
  const [selectedExamId, setSelectedExamId] = useState('');
  
  const [files, setFiles] = useState<File[]>([]);
  const [pdfPageCounts, setPdfPageCounts] = useState<Record<string, number>>({});
  const [calculatingPages, setCalculatingPages] = useState<Record<string, boolean>>({});

  const [uploadStatus, setUploadStatus] = useState<'idle' | 'uploading' | 'processing' | 'success' | 'error'>('idle');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [processingProgress, setProcessingProgress] = useState<{
    processedPages: number;
    totalPages: number;
    failedPages: number;
    status: string;
  } | null>(null);

  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [dragActive, setDragActive] = useState(false);


  const fileInputRef = useRef<HTMLInputElement>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Load active courses and exams on mount
  useEffect(() => {
    async function loadMetadata() {
      try {
        const [examsRes, coursesRes] = await Promise.all([
          fetch('/api/exams'),
          fetch('/api/courses')
        ]);

        const examsData = await examsRes.json();
        const coursesData = await coursesRes.json();

        if (examsData.success && Array.isArray(examsData.data)) {
          setExams(examsData.data);
        }
        if (coursesData.success && Array.isArray(coursesData.data)) {
          setCourses(coursesData.data);
        }
      } catch (err) {
        console.error('Failed to load exams/courses list', err);
        setErrorMessage('Failed to load exam details. Please refresh the page.');
      } finally {
        setLoadingExams(false);
      }
    }

    loadMetadata();

    return () => {
      if (xhrRef.current) xhrRef.current.abort();
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, []);

  const courseMap = React.useMemo(() => {
    return new Map(courses.map(c => [c._id, c]));
  }, [courses]);

  // Handle Drag Events
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  // Helper to add files and initiate page counting asynchronously
  const addFiles = (selectedFiles: FileList | null) => {
    if (!selectedFiles) return;

    const newFiles: File[] = [];
    const allowedExtensions = ['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.tiff', '.gif'];

    for (let i = 0; i < selectedFiles.length; i++) {
      const file = selectedFiles[i];
      const nameLower = file.name.toLowerCase();
      
      // Match extension
      const isValidExt = allowedExtensions.some(ext => nameLower.endsWith(ext));
      if (!isValidExt) {
        setErrorMessage(`Unsupported file format for "${file.name}". Only PDF and images are accepted.`);
        continue;
      }

      // Avoid exact duplicates by name
      if (files.some(f => f.name === file.name)) {
        continue;
      }

      newFiles.push(file);
    }

    if (newFiles.length === 0) return;

    setFiles(prev => [...prev, ...newFiles]);

    // Calculate PDF page counts asynchronously without blocking UI
    newFiles.forEach(file => {
      if (file.name.toLowerCase().endsWith('.pdf')) {
        setCalculatingPages(prev => ({ ...prev, [file.name]: true }));
        countPdfPages(file)
          .then(pages => {
            setPdfPageCounts(prev => ({ ...prev, [file.name]: pages }));
          })
          .catch(err => {
            console.error('Failed to parse PDF', file.name, err);
            setPdfPageCounts(prev => ({ ...prev, [file.name]: -1 }));
          })
          .finally(() => {
            setCalculatingPages(prev => ({ ...prev, [file.name]: false }));
          });
      }
    });
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      addFiles(e.target.files);
    }
  };

  const removeFile = (nameToRemove: string) => {
    setFiles(prev => prev.filter(f => f.name !== nameToRemove));
    setPdfPageCounts(prev => {
      const updated = { ...prev };
      delete updated[nameToRemove];
      return updated;
    });
    setCalculatingPages(prev => {
      const updated = { ...prev };
      delete updated[nameToRemove];
      return updated;
    });
  };

  const clearAllFiles = () => {
    setFiles([]);
    setPdfPageCounts({});
    setCalculatingPages({});
    setErrorMessage('');
  };

  // Run validation
  const validation = validateFiles(files, pdfPageCounts);
  const isPdfCountingActive = Object.values(calculatingPages).some(val => val);
  
  // Can submit if:
  // - An exam is selected
  // - Files are selected
  // - Page counts are fully loaded/calculated
  // - Client validation is fully valid
  // - Not currently uploading or processing
  const canUpload = 
    selectedExamId && 
    files.length > 0 && 
    !isPdfCountingActive && 
    validation.isValid && 
    uploadStatus === 'idle';

  // Format File Size helper
  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // 1. Upload Phase (using XMLHttpRequest to capture real progress)
  const handleUpload = () => {
    if (!canUpload) return;

    setErrorMessage('');
    setSuccessMessage('');
    setUploadStatus('uploading');
    setUploadProgress(0);

    const formData = new FormData();
    formData.append('examId', selectedExamId);
    files.forEach((file) => {
      formData.append('files', file);
    });

    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;

    xhr.open('POST', '/api/ingest', true);

    // Track upload progress
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        const percentComplete = Math.round((event.loaded / event.total) * 100);
        setUploadProgress(percentComplete);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const res = JSON.parse(xhr.responseText);
          if (res.success && res.data?.batchId) {
            if (role === 'PROFESSOR') {
              router.push(`/professor/exams/batches/${res.data.batchId}`);
            } else {
              router.push(`/admin/exams/batches/${res.data.batchId}`);
            }
          } else {
            setUploadStatus('error');
            setErrorMessage(res.message || 'Server processed upload but returned unexpected structure.');
          }
        } catch {
          setUploadStatus('error');
          setErrorMessage('Failed to parse upload confirmation from server.');
        }
      } else {
        setUploadStatus('error');
        try {
          const res = JSON.parse(xhr.responseText);
          setErrorMessage(res.message || `Upload failed with status code ${xhr.status}`);
        } catch {
          if (xhr.status === 413) {
            setErrorMessage('Upload rejected. Total batch size exceeds server size limits.');
          } else {
            setErrorMessage(`Upload failed with status code ${xhr.status}.`);
          }
        }
      }
    };

    xhr.onerror = () => {
      setUploadStatus('error');
      setErrorMessage('Network error occurred during upload. Please check your connection.');
    };

    xhr.send(formData);
  };



  // Cancel/Reset uploading state
  const handleReset = () => {
    if (xhrRef.current) {
      xhrRef.current.abort();
      xhrRef.current = null;
    }
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    setUploadStatus('idle');
    setUploadProgress(0);
    setProcessingProgress(null);
    setErrorMessage('');
    setSuccessMessage('');
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto font-sans">
      {/* Alert Messages */}
      {successMessage && (
        <div className="flex items-center gap-3 bg-emerald-50 border border-emerald-200 rounded-brand p-4 text-emerald-800 text-sm font-semibold shadow-2xs">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600 animate-bounce" />
          <span>{successMessage}</span>
        </div>
      )}

      {errorMessage && (
        <div className="flex flex-col gap-2 bg-rose-50 border border-rose-200 rounded-brand p-4 text-rose-800 text-sm font-semibold shadow-2xs">
          <div className="flex items-center gap-3">
            <AlertCircle className="h-5 w-5 shrink-0 text-rose-600" />
            <span>{errorMessage}</span>
          </div>
          {uploadStatus === 'error' && (
            <div className="mt-2 flex gap-2">
              <Button variant="outline" size="sm" onClick={handleReset}>
                <RefreshCw className="h-3.5 w-3.5 mr-1" />
                <span>Retry</span>
              </Button>
            </div>
          )}
        </div>
      )}

      <Card className="shadow-md border border-slate-200 bg-white">
        {/* State 1: Ingestion Active (Uploading or Processing) */}
        {uploadStatus === 'uploading' && (
          <div className="py-12 px-6 flex flex-col items-center justify-center text-center space-y-6">
            <div className="h-16 w-16 rounded-full bg-brand-primary/10 flex items-center justify-center text-brand-primary animate-pulse">
              <UploadCloud className="h-8 w-8 animate-bounce" />
            </div>
            <div className="space-y-2">
              <h3 className="text-xl font-bold text-slate-900">Uploading Answer Sheets</h3>
              <p className="text-sm text-slate-500 max-w-sm">
                Transmitting files to evaluation servers. Please do not close this window.
              </p>
            </div>
            <div className="w-full max-w-md space-y-2">
              <div className="relative w-full h-3 bg-slate-100 rounded-full overflow-hidden border border-slate-200">
                <div 
                  className="absolute inset-y-0 left-0 bg-brand-primary transition-all duration-300 rounded-full"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
              <div className="flex justify-between text-xs font-bold text-slate-500">
                <span>Uploading...</span>
                <span>{uploadProgress}%</span>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={handleReset}>
              <X className="h-4 w-4 mr-1" />
              <span>Cancel</span>
            </Button>
          </div>
        )}

        {uploadStatus === 'processing' && (
          <div className="py-12 px-6 flex flex-col items-center justify-center text-center space-y-6">
            <div className="h-16 w-16 rounded-full bg-brand-secondary/10 flex items-center justify-center text-brand-secondary">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
            <div className="space-y-2">
              <h3 className="text-xl font-bold text-slate-900">Processing Answer Sheets</h3>
              <p className="text-sm text-slate-500 max-w-sm">
                Servers are running QR detection, enhancing pages, and identifying student mappings.
              </p>
            </div>
            <div className="w-full max-w-md space-y-2">
              {processingProgress ? (
                <>
                  <div className="relative w-full h-3 bg-slate-100 rounded-full overflow-hidden border border-slate-200">
                    <div 
                      className="absolute inset-y-0 left-0 bg-brand-secondary transition-all duration-500 rounded-full"
                      style={{ 
                        width: `${
                          processingProgress.totalPages > 0 
                            ? Math.round((processingProgress.processedPages / processingProgress.totalPages) * 100) 
                            : 0
                        }%` 
                      }}
                    />
                  </div>
                  <div className="flex justify-between text-xs font-bold text-slate-500">
                    <span>
                      {processingProgress.status === 'queued' 
                        ? 'Queued for processing...' 
                        : `Processing... ${processingProgress.processedPages}/${processingProgress.totalPages} pages`}
                    </span>
                    {processingProgress.totalPages > 0 && (
                      <span>
                        {Math.round((processingProgress.processedPages / processingProgress.totalPages) * 100)}%
                      </span>
                    )}
                  </div>
                </>
              ) : (
                <div className="text-sm font-semibold text-slate-400">
                  Contacting queue worker...
                </div>
              )}
            </div>
            <Button variant="outline" size="sm" onClick={handleReset}>
              <X className="h-4 w-4 mr-1" />
              <span>Stop Polling</span>
            </Button>
          </div>
        )}

        {/* State 2: Idle Input form */}
        {(uploadStatus === 'idle' || uploadStatus === 'success' || uploadStatus === 'error') && (
          <div className="space-y-6">
            <div className="border-b border-slate-200 pb-4">
              <h3 className="text-lg font-bold text-slate-900">Configure Answer Sheet Ingestion</h3>
              <p className="text-xs text-slate-500 mt-1">
                Select target exam and choose answer script sheets to evaluate. Limits are checked in real-time.
              </p>
            </div>

            {/* Exam Select */}
            <FormField label="Target Exam Selection" error={selectedExamId ? undefined : "Please select an exam before proceeding"}>
              {loadingExams ? (
                <div className="flex items-center gap-2 text-slate-500 text-sm py-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Loading owner-scoped exams...</span>
                </div>
              ) : exams.length === 0 ? (
                <div className="p-3 bg-amber-50 border border-amber-250 rounded-brand text-amber-800 text-xs font-semibold flex items-center gap-2">
                  <ShieldAlert className="h-4 w-4 shrink-0" />
                  <span>No exams available. Please create an exam first.</span>
                </div>
              ) : (
                <select
                  value={selectedExamId}
                  onChange={(e) => setSelectedExamId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-brand bg-white text-slate-900 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-brand-primary/20 focus:border-brand-primary transition-all shadow-2xs"
                >
                  <option value="">-- Select Exam --</option>
                  {exams.map((ex) => {
                    const matchedCourse = courseMap.get(ex.course);
                    const courseLabel = matchedCourse ? ` (${matchedCourse.courseCode})` : '';
                    return (
                      <option key={ex._id} value={ex._id}>
                        {ex.title}{courseLabel}
                      </option>
                    );
                  })}
                </select>
              )}
            </FormField>

            {/* Drag & Drop Zone */}
            <div className="space-y-2">
              <label className="text-sm font-bold text-slate-850">
                Answer Sheet Files Upload
              </label>
              
              <div
                onDragEnter={handleDrag}
                onDragOver={handleDrag}
                onDragLeave={handleDrag}
                onDrop={handleDrop}
                className={`relative border-2 border-dashed rounded-brand-lg p-8 flex flex-col items-center justify-center text-center cursor-pointer transition-all ${
                  dragActive
                    ? 'border-brand-primary bg-brand-primary/5 shadow-md shadow-brand-primary/5'
                    : 'border-slate-300 bg-slate-50 hover:bg-slate-100 hover:border-slate-400'
                }`}
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".pdf,image/*"
                  onChange={handleFileChange}
                  className="hidden"
                />

                <div className="h-12 w-12 rounded-full bg-white flex items-center justify-center text-slate-500 shadow-sm border border-slate-200 mb-3 transition-transform group-hover:scale-105">
                  <UploadCloud className="h-6 w-6 text-slate-400" />
                </div>
                
                <p className="text-sm font-bold text-slate-800">
                  Drag and drop files here, or <span className="text-brand-primary underline">browse</span>
                </p>
                <p className="text-2xs text-slate-400 mt-1 max-w-xs leading-normal">
                  Supports PDF (max 200 pages) and high resolution images (JPG, PNG, WebP, TIFF, GIF). Max 50MB per file.
                </p>
              </div>
            </div>

            {/* Validation & Selected files info */}
            {files.length > 0 && (
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-slate-150 pb-2">
                  <span className="text-xs font-black text-slate-700 uppercase tracking-wider">
                    Selected Files ({files.length})
                  </span>
                  <button 
                    onClick={clearAllFiles} 
                    className="text-xs font-bold text-rose-600 hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    Clear All
                  </button>
                </div>

                {validation.generalError && (
                  <div className="flex items-start gap-2.5 bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold p-3 rounded-brand">
                    <AlertCircle className="h-4 w-4 shrink-0 text-rose-600 mt-0.5" />
                    <span>{validation.generalError}</span>
                  </div>
                )}

                <div className="max-h-60 overflow-y-auto divide-y divide-slate-100 pr-1 space-y-1">
                  {files.map((file) => {
                    const isPdf = file.name.toLowerCase().endsWith('.pdf');
                    const pageCount = pdfPageCounts[file.name];
                    const isCounting = calculatingPages[file.name];
                    
                    const fileError = validation.errors.find(e => e.fileName === file.name);

                    return (
                      <div 
                        key={file.name} 
                        className={`flex items-center justify-between py-2 px-3 rounded-brand text-sm transition-colors ${
                          fileError ? 'bg-rose-50/50 hover:bg-rose-50' : 'hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <div className={`p-1.5 rounded bg-white border ${fileError ? 'border-rose-300 text-rose-500' : 'border-slate-200 text-slate-500'}`}>
                            <FileText className="h-4 w-4" />
                          </div>
                          
                          <div className="min-w-0 flex-1">
                            <p className={`font-semibold truncate text-xs ${fileError ? 'text-rose-800' : 'text-slate-800'}`}>
                              {file.name}
                            </p>
                            <div className="flex items-center gap-3 text-3xs text-slate-500 font-medium mt-0.5">
                              <span>{formatSize(file.size)}</span>
                              {isPdf && (
                                <span className="flex items-center gap-1">
                                  •
                                  {isCounting ? (
                                    <span className="flex items-center gap-1 text-slate-400">
                                      <Loader2 className="h-2.5 w-2.5 animate-spin" />
                                      Counting pages...
                                    </span>
                                  ) : pageCount === -1 ? (
                                    <span className="text-rose-600">Corrupted PDF</span>
                                  ) : (
                                    <span>{pageCount} pages</span>
                                  )}
                                </span>
                              )}
                            </div>
                            {fileError && (
                              <p className="text-3xs font-bold text-rose-600 mt-1 flex items-center gap-1">
                                <AlertCircle className="h-3 w-3 shrink-0" />
                                <span>{fileError.error}</span>
                              </p>
                            )}
                          </div>
                        </div>

                        <button
                          onClick={() => removeFile(file.name)}
                          className="p-1 rounded text-slate-400 hover:text-rose-600 hover:bg-white hover:border-slate-200 border border-transparent transition-colors cursor-pointer ml-4"
                          aria-label={`Remove ${file.name}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
              <Link href={role === 'PROFESSOR' ? '/professor/exams' : '/admin'}>
                <Button variant="outline">
                  <span>Cancel</span>
                </Button>
              </Link>
              <Button
                variant="primary"
                onClick={handleUpload}
                disabled={!canUpload}
                isLoading={isPdfCountingActive}
              >
                <span>Upload Batch</span>
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
