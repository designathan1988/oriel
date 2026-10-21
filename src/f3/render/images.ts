// Project images (photos, posters, logos) as textures, loaded once
// per image and shared by every plate using it.
import * as THREE from 'three';
import type { ProjectImage } from '../model/schema';

const data = new Map<string, string>();
const textures = new Map<string, THREE.Texture>();
const listeners = new Set<() => void>();

/** Notifies when an image finishes loading (the view redraws). */
export function onImageLoad(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Registers the project images (called on every view sync). */
export function setProjectImages(list: ProjectImage[] | undefined): void {
  for (const im of list ?? []) if (data.get(im.id) !== im.data) {
    data.set(im.id, im.data);
    textures.get(im.id)?.dispose();
    textures.delete(im.id);
  }
}

/** Texture of a project image (empty until it loads). */
export function imageTexture(id: string, anisotropy = 8): THREE.Texture {
  let t = textures.get(id);
  if (t) return t;
  t = new THREE.Texture();
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = anisotropy;
  textures.set(id, t);
  const src = data.get(id);
  if (src && typeof Image !== 'undefined') {
    const img = new Image();
    img.onload = () => {
      t!.image = img;
      t!.needsUpdate = true;
      for (const fn of listeners) fn();
    };
    img.src = src;
  }
  return t;
}

/** Reads an image file, shrinks it to at most 2048 px and returns it as embedded data. */
export function readImageFile(file: File): Promise<ProjectImage> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error('could not read the file'));
    fr.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('the file is not an image'));
      img.onload = () => {
        const k = Math.min(1, 2048 / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.naturalWidth * k));
        c.height = Math.max(1, Math.round(img.naturalHeight * k));
        c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
        const png = /png|gif|webp/.test(file.type);
        resolve({ id: (globalThis.crypto?.randomUUID?.() ?? `img-${Date.now()}`), name: file.name.replace(/\.[^.]+$/, '').slice(0, 60) || 'Image', data: c.toDataURL(png ? 'image/png' : 'image/jpeg', 0.9), w: c.width, h: c.height });
      };
      img.src = String(fr.result);
    };
    fr.readAsDataURL(file);
  });
}
