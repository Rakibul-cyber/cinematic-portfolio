import { saveProjectAction } from "@/app/(admin)/admin/cms-actions";
import {
  areaClass,
  buttonClass,
  inputClass,
} from "@/components/admin/admin-shell";
type Category = { id: string; name: string };
type Media = { id: string; originalName: string; altText: string | null };
type Project = {
  id: string;
  title: string;
  slug: string;
  summary: string;
  description: string;
  clientName: string | null;
  location: string | null;
  projectDate: Date | null;
  categoryId: string;
  status: "DRAFT" | "PUBLISHED";
  featured: boolean;
  sortOrder: number;
  seoTitle: string | null;
  seoDescription: string | null;
  media: { mediaId: string }[];
};
export function ProjectForm({
  project,
  categories,
  media,
}: {
  project?: Project;
  categories: Category[];
  media: Media[];
}) {
  const selected = new Set(project?.media.map((m) => m.mediaId));
  return (
    <form action={saveProjectAction} className="grid gap-4">
      {project && <input type="hidden" name="id" value={project.id} />}
      <label>
        Title
        <input
          className={inputClass}
          name="title"
          defaultValue={project?.title}
          required
        />
      </label>
      <label>
        Slug
        <input
          className={inputClass}
          name="slug"
          defaultValue={project?.slug}
          required
        />
      </label>
      <label>
        Category
        <select
          className={inputClass}
          name="categoryId"
          defaultValue={project?.categoryId}
          required
        >
          <option value="">Select category</option>
          {categories.map((c) => (
            <option value={c.id} key={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Summary
        <textarea
          className={areaClass}
          name="summary"
          defaultValue={project?.summary}
          required
        />
      </label>
      <label>
        Description
        <textarea
          className="min-h-56 w-full border border-border bg-background p-3"
          name="description"
          defaultValue={project?.description}
          required
        />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label>
          Client
          <input
            className={inputClass}
            name="clientName"
            defaultValue={project?.clientName ?? ""}
          />
        </label>
        <label>
          Location
          <input
            className={inputClass}
            name="location"
            defaultValue={project?.location ?? ""}
          />
        </label>
        <label>
          Project date
          <input
            className={inputClass}
            type="date"
            name="projectDate"
            defaultValue={
              project?.projectDate?.toISOString().slice(0, 10) ?? ""
            }
          />
        </label>
        <label>
          Order
          <input
            className={inputClass}
            type="number"
            name="sortOrder"
            defaultValue={project?.sortOrder ?? 0}
          />
        </label>
        <label>
          Status
          <select
            className={inputClass}
            name="status"
            defaultValue={project?.status ?? "DRAFT"}
          >
            <option>DRAFT</option>
            <option>PUBLISHED</option>
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            name="featured"
            defaultChecked={project?.featured}
          />{" "}
          Featured
        </label>
      </div>
      <label>
        SEO title
        <input
          className={inputClass}
          name="seoTitle"
          defaultValue={project?.seoTitle ?? ""}
        />
      </label>
      <label>
        SEO description
        <textarea
          className={areaClass}
          name="seoDescription"
          defaultValue={project?.seoDescription ?? ""}
        />
      </label>
      <fieldset className="grid gap-2 border border-border p-4">
        <legend>Project media</legend>
        <p className="text-sm text-muted-foreground">
          Selected media is ordered as shown; the first selection is the cover.
        </p>
        {media.length ? (
          media.map((m) => (
            <label key={m.id} className="flex gap-2">
              <input
                type="checkbox"
                name="mediaIds"
                value={m.id}
                defaultChecked={selected.has(m.id)}
              />
              <span>
                {m.originalName} · {m.altText || "alt text missing"}
              </span>
            </label>
          ))
        ) : (
          <p>No media available. Upload media first.</p>
        )}
      </fieldset>
      <button className={buttonClass}>Save project</button>
    </form>
  );
}
