-- =====================================================================
-- المرحلة الأولى — الملف 4: التخزين الدائم للصور والفواتير (Supabase Storage)
-- حاوية خاصة (غير عامة). مسار الملف: {entity_type}/{entity_id}/{uuid}-{اسم الملف}
-- الوصول للملف نفسه مشروط بوجود سجل مرفق يراه المستخدم حسب صلاحياته.
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('attachments', 'attachments', false, 20971520,  -- 20 ميجابايت للملف
        array['image/jpeg','image/png','image/heic','image/heif','image/webp','application/pdf'])
on conflict (id) do nothing;

-- قراءة/تنزيل: فقط إذا كان المستخدم يرى سجل المرفق المرتبط (تطبَّق عليه RLS للمرفقات)
create policy attachments_read on storage.objects for select to authenticated
  using (bucket_id = 'attachments'
         and exists (select 1 from public.attachments a where a.storage_path = storage.objects.name));

-- رفع: لمن يملك صلاحية الإضافة أو إدارة الفواتير
create policy attachments_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments' and (public.has_perm('create') or public.has_perm('invoices')));

-- لا تعديل ولا حذف للملفات من التطبيق؛ الأرشفة تتم على سجل المرفق فقط
-- (لا توجد سياسات update/delete ⇒ ممنوعة)
