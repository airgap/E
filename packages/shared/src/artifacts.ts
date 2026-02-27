export type ArtifactType = 'plan' | 'diff' | 'screenshot' | 'walkthrough' | 'report' | 'canvas';

export interface Artifact {
  id: string;
  conversationId: string;
  messageId?: string;
  type: ArtifactType;
  title: string;
  content: string;
  metadata: Record<string, unknown>;
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ArtifactCreateInput {
  conversationId: string;
  messageId?: string;
  type: ArtifactType;
  title: string;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface ArtifactUpdateInput {
  title?: string;
  content?: string;
  metadata?: Record<string, unknown>;
  pinned?: boolean;
}

/** Content block type emitted when an artifact is extracted from an agent message */
export interface ArtifactContent {
  type: 'artifact';
  artifactId: string;
  artifactType: ArtifactType;
  title: string;
}
