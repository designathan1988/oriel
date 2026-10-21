// Smaller GLB files with glTF-Transform (https://gltf-transform.dev/, MIT) and meshoptimizer
// (https://github.com/zeux/meshoptimizer, MIT), in the browser:
//  - dedup (identical meshes, materials and textures written once), prune (nothing unused), weld
//    (identical vertices merged);
//  - textures re-encoded as WebP, at most `maxTexture` px (EXT_texture_webp, read by three.js and
//    Blender); in the browser the platform encoder is used (glTF-Transform ignores the quality options);
//  - `meshopt`: geometry compressed with EXT_meshopt_compression (readers need the meshopt decoder:
//    three.js GLTFLoader.setMeshoptDecoder), so it is an option, never the default.
import { WebIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, textureCompress, weld } from '@gltf-transform/functions';

export interface GlbOptions {
  /** Largest texture side (px); 0 keeps the textures as they are. */
  maxTexture?: number;
  /** Compress the geometry with meshopt (smaller, needs the decoder to open). */
  meshopt?: boolean;
}

export async function optimizeGlb(glb: Uint8Array, opts: GlbOptions = {}): Promise<Uint8Array> {
  const io = new WebIO().registerExtensions(ALL_EXTENSIONS);
  let encoder: unknown = null;
  if (opts.meshopt) {
    const { MeshoptEncoder } = await import('meshoptimizer');
    await MeshoptEncoder.ready;
    encoder = MeshoptEncoder;
    io.registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
  }
  const doc = await io.readBinary(glb);
  const steps = [dedup(), prune(), weld()];
  if (opts.maxTexture) steps.push(textureCompress({ targetFormat: 'webp', resize: [opts.maxTexture, opts.maxTexture] }));
  if (encoder) steps.push(meshopt({ encoder, level: 'medium' }));
  await doc.transform(...steps);
  return io.writeBinary(doc);
}
