"use client";

import { useActionState, useEffect, useRef } from "react";
import { Checkbox, Field, FormMessage, Input, Select, SubmitButton, Textarea } from "@/components/form";
import { useActionRedirect } from "@/components/use-action-redirect";

type State = { ok: true; message?: string; redirectTo?: string } | { ok: false; error: string; fieldErrors?: Record<string, string[] | undefined> } | null;

export function CategoryForm({
  action,
  parents,
  initial,
  submitLabel,
  readOnly,
}: {
  action: (state: State, formData: FormData) => Promise<State>;
  parents: { id: string; name: string; depth: number }[];
  initial?: { name: string; slug: string; description: string | null; parentId: string | null; position: number; isActive: boolean };
  submitLabel: string;
  readOnly?: boolean;
}) {
  const [state, formAction] = useActionState(action, null);
  useActionRedirect(state);
  const formRef = useRef<HTMLFormElement>(null);
  const errors = state && !state.ok ? state.fieldErrors ?? {} : {};

  // Clear the "add" form after a successful create.
  useEffect(() => {
    if (state?.ok && !initial) formRef.current?.reset();
  }, [state, initial]);

  return (
    <form ref={formRef} action={formAction} className="space-y-4">
      <fieldset disabled={readOnly} className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" error={errors.name}>
          <Input name="name" required maxLength={80} defaultValue={initial?.name} placeholder="e.g. Dresses" />
        </Field>
        <Field label="Parent" error={errors.parentId}>
          <Select name="parentId" defaultValue={initial?.parentId ?? ""}>
            <option value="">None (top level)</option>
            {parents.map((p) => (
              <option key={p.id} value={p.id}>
                {"— ".repeat(p.depth)}
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="URL handle" hint="Leave empty to generate from the name" error={errors.slug}>
          <Input name="slug" maxLength={80} defaultValue={initial?.slug} pattern="[a-z0-9]+(-[a-z0-9]+)*" />
        </Field>
        <Field label="Sort order" error={errors.position}>
          <Input name="position" type="number" min={0} defaultValue={initial?.position ?? 0} />
        </Field>
        <Field label="Description" className="sm:col-span-2" error={errors.description}>
          <Textarea name="description" maxLength={2000} rows={2} defaultValue={initial?.description ?? ""} />
        </Field>
        <Checkbox name="isActive" label="Visible in store" defaultChecked={initial?.isActive ?? true} />
      </fieldset>
      <div className="flex items-center gap-3">
        <SubmitButton disabled={readOnly}>{submitLabel}</SubmitButton>
        <FormMessage state={state} />
      </div>
    </form>
  );
}
