import { useCallback, useId, useRef, useState, type ChangeEvent } from "react";
import { parseProjectAreaGeoJson } from "../../lib/projectArea/geometry";
import type {
  ProjectArea,
  ProjectAreaDrawingMode,
} from "../../lib/projectArea/types";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export type ProjectAreaPanelProps = {
  projectArea: ProjectArea | null;
  drawingMode: ProjectAreaDrawingMode;
  draftVertexCount?: number;
  canFinishDrawing?: boolean;
  disabled?: boolean;
  statusText?: string;
  onProjectAreaChange: (projectArea: ProjectArea) => void;
  onStartDrawing: (mode: Exclude<ProjectAreaDrawingMode, null>) => void;
  onFinishDrawing: () => void;
  onCancelDrawing: () => void;
  onClear: () => void;
};

/**
 * Controlled project-area toolbar. The map owns draft coordinates and converts
 * them with createPolygonProjectArea/createRectangleProjectArea on completion.
 */
export function ProjectAreaPanel({
  projectArea,
  drawingMode,
  draftVertexCount = 0,
  canFinishDrawing = false,
  disabled = false,
  statusText,
  onProjectAreaChange,
  onStartDrawing,
  onFinishDrawing,
  onCancelDrawing,
  onClear,
}: ProjectAreaPanelProps) {
  const inputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isReadingFile, setIsReadingFile] = useState(false);

  const handleUpload = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const input = event.currentTarget;
      const file = input.files?.[0];
      input.value = "";
      if (!file) return;
      if (file.size > MAX_UPLOAD_BYTES) {
        setUploadError("The project layer is larger than 10 MB. Simplify it before uploading.");
        return;
      }

      setIsReadingFile(true);
      setUploadError(null);
      try {
        const text = await file.text();
        const projectArea = parseProjectAreaGeoJson(text, {
          fileName: file.name,
          label: fileNameToLabel(file.name),
        });
        onProjectAreaChange(projectArea);
      } catch (error) {
        setUploadError(error instanceof Error ? error.message : String(error));
      } finally {
        setIsReadingFile(false);
      }
    },
    [onProjectAreaChange],
  );

  const handleStartDrawing = useCallback(
    (mode: Exclude<ProjectAreaDrawingMode, null>) => {
      setUploadError(null);
      onStartDrawing(mode);
    },
    [onStartDrawing],
  );

  const derivedStatus = statusText ?? projectAreaStatus(projectArea, drawingMode, draftVertexCount);
  const controlsDisabled = disabled || isReadingFile;

  return (
    <section className="project-area-panel panel" aria-labelledby={`${inputId}-heading`}>
      <div className="panel-heading">
        <div>
          <span className="label">Analysis extent</span>
          <strong id={`${inputId}-heading`}>Project area</strong>
        </div>
        {projectArea ? (
          <button
            type="button"
            className="ghost-button"
            disabled={controlsDisabled || drawingMode !== null}
            onClick={onClear}
            aria-label={`Clear project area ${projectArea.label}`}
          >
            Clear
          </button>
        ) : null}
      </div>

      {!disabled || drawingMode ? (
      <div className="project-area-actions" role="group" aria-label="Define project area">
        <button
          type="button"
          className="ghost-button project-area-upload"
          disabled={controlsDisabled || drawingMode !== null}
          onClick={() => fileInputRef.current?.click()}
        >
          {isReadingFile ? "Reading layer…" : "Upload GeoJSON"}
        </button>
        <input
          ref={fileInputRef}
          id={inputId}
          className="sr-only"
          type="file"
          accept=".geojson,.json,application/geo+json,application/json"
          disabled={controlsDisabled || drawingMode !== null}
          onChange={handleUpload}
          aria-label="Upload project boundary as GeoJSON"
          aria-describedby={`${inputId}-help`}
          tabIndex={-1}
        />
        <button
          type="button"
          className="ghost-button"
          aria-pressed={drawingMode === "polygon"}
          disabled={controlsDisabled || drawingMode !== null}
          onClick={() => handleStartDrawing("polygon")}
        >
          Draw polygon
        </button>
        <button
          type="button"
          className="ghost-button"
          aria-pressed={drawingMode === "rectangle"}
          disabled={controlsDisabled || drawingMode !== null}
          onClick={() => handleStartDrawing("rectangle")}
        >
          Draw rectangle
        </button>
      </div>
      ) : null}

      {drawingMode ? (
        <div className="project-area-drawing-actions" role="group" aria-label="Drawing actions">
          <button
            type="button"
            className="ghost-button"
            disabled={controlsDisabled || !canFinishDrawing}
            onClick={onFinishDrawing}
          >
            Finish {drawingMode}
          </button>
          <button
            type="button"
            className="ghost-button"
            disabled={controlsDisabled}
            onClick={onCancelDrawing}
          >
            Cancel drawing
          </button>
        </div>
      ) : null}

      <p id={`${inputId}-help`} className="project-area-status" aria-live="polite">
        {derivedStatus}
      </p>
      {uploadError ? (
        <p className="project-area-error" role="alert">
          {uploadError}
        </p>
      ) : null}
      {projectArea?.caveats.length ? (
        <details className="project-area-caveats">
          <summary>Boundary notes</summary>
          <ul>
            {projectArea.caveats.map((caveat) => (
              <li key={caveat}>{caveat}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

function projectAreaStatus(
  projectArea: ProjectArea | null,
  drawingMode: ProjectAreaDrawingMode,
  draftVertexCount: number,
): string {
  if (drawingMode === "polygon") {
    return `Polygon drawing active. ${draftVertexCount} ${draftVertexCount === 1 ? "point" : "points"} set. Add at least three points and close the polygon.`;
  }
  if (drawingMode === "rectangle") {
    return "Rectangle drawing active. Set two opposite corners on the map, then finish the rectangle.";
  }
  if (projectArea) {
    return `${projectArea.label}: ${formatArea(projectArea.areaSqm)}. This boundary will define the spatial analysis extent.`;
  }
  return "Upload a WGS84 GeoJSON polygon or draw a boundary up to 5 km diagonally. A map click remains available when no project area is set.";
}

function formatArea(areaSqm: number): string {
  if (areaSqm >= 1_000_000) return `${(areaSqm / 1_000_000).toFixed(2)} km²`;
  if (areaSqm >= 10_000) return `${(areaSqm / 10_000).toFixed(2)} ha`;
  return `${Math.round(areaSqm).toLocaleString()} m²`;
}

function fileNameToLabel(fileName: string): string {
  const withoutExtension = fileName.replace(/\.(geo)?json$/i, "");
  return withoutExtension.trim() || "Uploaded project area";
}
