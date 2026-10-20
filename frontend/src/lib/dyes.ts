import { AudioLines, BookOpen, FileText, Film, Folder, Image, Layers, NotebookPen, type LucideIcon } from 'lucide-react'
import type { FileKind } from './api'

/** The kinds of things on the shelf, each with its dye (tokens.css): folders 藍, lessons 萌葱,
 *  notes 山吹, recordings 柿, documents 紫, collected sources 浅葱. */
export type Dye = 'folder' | 'lesson' | 'note' | 'media' | 'doc' | 'source'

export const fileDye = (k: FileKind): Dye => k === 'audio' || k === 'video' ? 'media' : 'doc'
export const fileIcon: Record<FileKind, LucideIcon> = { pdf: FileText, audio: AudioLines, video: Film, image: Image, text: FileText }
export const dyeIcon: Record<Dye, LucideIcon> = { folder: Folder, lesson: BookOpen, note: NotebookPen, media: AudioLines, doc: FileText, source: Layers }
