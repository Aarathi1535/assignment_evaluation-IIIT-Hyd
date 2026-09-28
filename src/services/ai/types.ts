export interface VertexAIConfig {
  model: string;
  region: string;
  projectId: string;
}

export interface ServiceAccountCredentials {
  client_email: string;
  private_key: string;
  project_id?: string;
}

export interface GenerateContentParams {
  systemInstruction?: string;
  promptText: string;
  model?: string;
  temperature?: number;
  responseMimeType?: string;
}

export interface GenerateMultimodalContentParams extends GenerateContentParams {
  imageBase64: string;
  mimeType: string;
}

export type VertexAICaller = (payload: {
  model: string;
  region: string;
  systemInstruction: string;
  promptText: string;
  imageBase64?: string;
  mimeType?: string;
}) => Promise<string>;
