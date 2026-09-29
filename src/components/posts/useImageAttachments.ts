'use client';

import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { getSessionToken, uploadStorageFile } from '@/lib/firebase';

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const MAX_IMAGES = 8;

export function useImageAttachments(userId: string, collection: 'posts' | 'jobs', initialImages: string[] = []) {
  const [images, setImages] = useState(initialImages);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  const pendingFiles = useRef(new Map<string, File>());

  useEffect(() => {
    const files = pendingFiles.current;
    return () => {
      files.forEach((_, url) => URL.revokeObjectURL(url));
      files.clear();
    };
  }, []);

  const addFiles = (files: FileList | File[]) => {
    const selected = Array.from(files);
    const remaining = Math.max(0, MAX_IMAGES - images.length);
    const accepted = selected.filter((file) => file.type.startsWith('image/') && file.size <= MAX_FILE_SIZE).slice(0, remaining);
    const previews = accepted.map((file) => {
      const url = URL.createObjectURL(file);
      pendingFiles.current.set(url, file);
      return url;
    });
    if (previews.length) setImages((current) => [...current, ...previews]);
    setError(accepted.length === selected.length ? '' : '이미지 파일만, 파일당 5MB 이하로 최대 8장 첨부할 수 있습니다.');
  };

  const handleInput = (event: ChangeEvent<HTMLInputElement>) => {
    addFiles(event.currentTarget.files || []);
    event.currentTarget.value = '';
  };

  const handleDragOver = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDragging(true);
  };

  const handleDragLeave = (event: DragEvent<HTMLElement>) => {
    if (event.currentTarget === event.target) setDragging(false);
  };

  const handleDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDragging(false);
    addFiles(event.dataTransfer.files);
  };

  const removeImage = (index: number) => {
    const url = images[index];
    setImages((current) => current.filter((_, imageIndex) => imageIndex !== index));
    if (pendingFiles.current.delete(url)) URL.revokeObjectURL(url);
  };

  const clearImages = () => {
    pendingFiles.current.forEach((_, url) => URL.revokeObjectURL(url));
    pendingFiles.current.clear();
    setImages([]);
    setError('');
  };

  const uploadImages = async () => Promise.all(images.map((url) => {
    const file = pendingFiles.current.get(url);
    return file
      ? uploadStorageFile(file, `${collection}/${userId}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '-')}`, getSessionToken())
      : url;
  }));

  return { images, setImages, dragging, error, handleInput, handleDragOver, handleDragLeave, handleDrop, removeImage, uploadImages, clearImages };
}
