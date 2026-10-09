-- ============================================================================
--  ติดตั้งคลาวด์สำหรับโหมดรับออเดอร์ที่โต๊ะ
--  ฉบับ "ท่อส่งข้อมูล" (relay only) — เขียนใหม่ทั้งไฟล์ 9 ต.ค. 2026
-- ============================================================================
--
--  ### คลาวด์นี้ทำอะไร
--  รับ "ใบสั่ง" (JSON) จากมือถือพนักงาน เก็บไว้ แล้วให้เครื่องกลางมาดึงไปออกบิล
--  กับรับฝากรูปสลิปโอนเงินให้เครื่องกลางเปิดดูได้  **จบแค่นี้**
--
--  ### คลาวด์นี้ "ไม่" ทำอะไร — และห้ามเพิ่มทีหลัง
--  * ไม่คิดเงิน ไม่ตรวจยอด ไม่รู้จักราคาสินค้า ไม่รู้จักโปรโมชันของร้าน
--  * ไม่ออกเลขบิล ไม่ตัดสต็อก ไม่ตัดแต้ม
--
--  เหตุผล: ฉบับก่อนของไฟล์นี้ให้เซิร์ฟเวอร์ "ตัดสินเรื่องเงิน" โดยคิดยอดใหม่
--  จากราคาที่ **มือถือส่งมาเอง** แล้วเทียบกับยอดที่ **มือถือส่งมาเอง** อีกตัว
--  ซึ่งเป็นการตรวจที่วนกลับมาที่ตัวเอง (ไม่ได้ตรวจอะไรเลย) และทำให้ไฟล์ยาว
--  1,524 บรรทัดจนตรวจทานไม่ไหว — ตรวจแบบไม่ไว้หน้าแล้วพบข้อบกพร่อง 19 ข้อ
--
--  ตัวที่ตรวจยอดจริงคือ `validateTicket()` + `receiveTicket()` ที่เครื่องกลาง
--  (src/lib/tableOrderIntake.ts) เพราะที่นั่นมีรายการสินค้า โปรโมชัน และกะ
--  อยู่ครบ และมีเทสต์คุมอยู่  ดู TABLE-ORDER-PLAN.md §2 (single writer) และ §19
--
-- ============================================================================
--  ### วิธีติดตั้ง (ทำครั้งเดียว ที่หน้าเว็บ Supabase)
--
--  1. Authentication → Sign In / Providers → เปิด **Anonymous sign-ins**
--     (ถ้าไม่เปิด มือถือจะล็อกอินไม่ได้เลย)
--  1b. Authentication → Attack Protection → **เปิด CAPTCHA** และลดเพดาน
--     anonymous sign-in ต่อชั่วโมงลง  **ข้อนี้ไม่ใช่ของเสริม**: การล็อกอินแบบ
--     ไม่ระบุตัวตนคือสิ่งเดียวที่คนนอกทำได้โดยยังไม่มีรหัสผูกเครื่อง และทุกครั้ง
--     จะเขียนแถวลง auth.users ค่าเริ่มต้น 30 ครั้ง/ชม./ไอพี ≈ 21,600 ราย/เดือน
--     ต่อหนึ่งไอพี ⇒ สองไอพีก็ทะลุโควตาฟรี 50,000 รายต่อเดือนของโปรเจกต์ร้าน
--  2. SQL Editor → New query → วางไฟล์นี้ทั้งไฟล์ → Run
--     ต้องได้ตารางผลลัพธ์ว่า "ติดตั้งสำเร็จ" ถ้าขึ้น error สีแดง = ยังไม่ติดตั้ง
--     (ทั้งไฟล์รันเป็นก้อนเดียว ถ้าพลาดกลางทางจะย้อนกลับหมด ไม่ค้างครึ่งๆ)
--  3. ผูกเครื่องกลาง: SQL Editor → รัน
--
--         select pos.new_enroll_code('central');
--
--     จะได้รหัส 16 ตัวอักษร เอาไปกรอกที่เครื่องกลาง **ภายใน 30 นาที** ใช้ได้ครั้งเดียว
--  4. ผูกมือถือ: ที่เครื่องกลาง กดปุ่ม "เพิ่มเครื่องพนักงาน" (เครื่องกลางออกรหัสเองได้)
--  5. **ส่งแคตตาล็อกสินค้าไปที่มือถือ** — ข้อนี้ไม่ใช่ของเสริม ถ้าไม่ทำ
--     เครื่องกลางจะปฏิเสธใบสั่งจากมือถือทุกใบ (โดยเจตนา) เพราะรหัสสินค้าของ
--     มือถือที่ยังไม่ได้รับแคตตาล็อกจะชี้ไปคนละตัว แล้วสต็อกจะถูกตัดผิด
--     ตอนนี้ทำผ่านไฟล์: หน้าตั้งค่า → รับออเดอร์ที่โต๊ะ → "ส่งออกจากเครื่องกลาง"
--     แล้วส่งไฟล์ไปที่มือถือ → ที่มือถือกด "นำเข้าที่มือถือ"
--     ตอนต่อคลาวด์จะเปลี่ยนไปใช้ pos_put_config / pos_get_config ด้วยก้อนเดียวกัน
--     **แก้ราคาหรือเพิ่มสินค้าแล้วต้องส่งใหม่** ไม่งั้นยอดที่มือถือคิดจะไม่ตรง
--
--  ### เครื่องกลางหาย / เครื่องกลางพัง
--  รันข้อ 3 ซ้ำที่หน้าเว็บ Supabase **แล้วเอารหัสไปกรอกที่เครื่องใหม่**
--  เครื่องกลางตัวเก่าจะถูกถอนสิทธิ์ตอนที่เครื่องใหม่กรอกรหัสสำเร็จ (ไม่ใช่ตอนออกรหัส)
--  **นี่คือทางกู้คืนทั้งหมดของระบบ** ไม่มีรหัสกู้คืนให้จำ ไม่มีกระดาษให้หาย
--  เพราะสิทธิ์สูงสุดคือ "คนที่เข้าหน้าเว็บ Supabase ของร้านได้" ซึ่งก็คือเจ้าของร้าน
--
--  **ตอนเปลี่ยนเครื่องกลาง ใบสั่งที่ยังค้างจะถูกตีเป็นสถานะ 'review' ทั้งหมด**
--  เพราะเครื่องเก่าอาจออกบิลไปแล้วแต่ยังไม่ทันแจ้งกลับ ถ้าปล่อยให้เครื่องใหม่
--  ดึงไปทำต่ออัตโนมัติ จะได้บิลใบที่สองของเงินก้อนเดิม — ต้องให้คนมาดูทีละใบ
--
--  ### ถอนสิทธิ์มือถือที่หาย
--  ทำที่เครื่องกลางได้เลย (pos_revoke_device) หรือที่หน้าเว็บ:
--      update pos.devices set revoked_at = now() where label = 'มือถือ A';
--  รูปสลิปที่เครื่องนั้นจองไว้แล้วยังอัปโหลดได้อีก 2 วัน **โดยเจตนา** —
--  หลักฐานการรับเงินของลูกค้าต้องไม่หายไปเพราะร้านเปลี่ยนมือถือ
--
--  ### ล้างของเก่า (เดือนละครั้ง หรือเมื่อพื้นที่ใกล้เต็ม)
--      select pos.purge(90);
--  ลบใบสั่งที่ปิดเรื่องแล้ว ใบจองรูปที่ไม่เคยมีไฟล์ และผู้ใช้ชั่วคราวที่ไม่ได้ผูกเครื่อง
--  **ไฟล์รูปสลิปที่อัปโหลดขึ้นไปแล้วไม่ถูกลบ** — ลบด้วย SQL ไม่ได้ (ลบได้แต่ทะเบียน
--  ไฟล์จริงยังกินโควตาและกลายเป็นไฟล์ลอยที่ไม่รู้ว่าของโต๊ะไหน) ต้องลบที่หน้า
--  Storage ของ Supabase หรือให้แอปเครื่องกลางลบผ่าน Storage API (มีนโยบายให้แล้ว)
--  ไม่ได้ตั้ง cron ไว้ในไฟล์นี้โดยเจตนา — pg_cron ไม่ได้เปิดทุกโปรเจกต์
--  และ cron ที่เงียบเวลาพังคือของที่ไว้ใจไม่ได้
--
--  ### แก้ฟังก์ชันทีหลัง
--  ถ้า create or replace ฟังก์ชันตัวใดตัวหนึ่งใหม่ Supabase จะคืนสิทธิ์ให้ anon
--  ตาม default privileges ของมันเอง — **ต้องรันบล็อก "สิทธิ์" ท้ายไฟล์นี้ซ้ำทุกครั้ง**
--  และถ้าจะแก้ชนิด/ชื่อคอลัมน์ที่ `returns table(...)` คืน ต้อง drop function ก่อน
--  (create or replace เปลี่ยนรูปของผลลัพธ์ไม่ได้)
--
--  ### ของที่ต้องมีอยู่แล้วในโปรเจกต์ (ถ้าขาด ไฟล์นี้จะล้มทั้งไฟล์ ไม่ใช่ทำครึ่งๆ)
--  schema `extensions` + pgcrypto · role `anon` และ `authenticated` ·
--  `auth.uid()` · `postgres` ต้องแก้ policy ของ `storage.objects` ได้
--  ทั้งหมดนี้มีครบในโปรเจกต์ Supabase มาตรฐาน
-- ============================================================================

create extension if not exists pgcrypto with schema extensions;


-- ============================================================================
--  0. ตรวจก่อนเริ่ม
--
--  ต้องอยู่ก่อนทุกอย่าง เพราะฟังก์ชัน language sql ถูกตรวจไวยากรณ์ตอน create
--  ถ้า pgcrypto ไม่ได้อยู่ใน schema extensions (เช่นเคยติดตั้งไว้ใน public
--  ซึ่งทำให้ create extension if not exists ข้างบนเป็น no-op แบบไม่ฟ้อง)
--  pos.code_hash จะล้มด้วย error ภาษาอังกฤษดิบๆ แทนคำอธิบายที่อ่านรู้เรื่อง
-- ============================================================================

do $pre$
begin
  if to_regprocedure('extensions.digest(text,text)') is null
     or to_regprocedure('extensions.gen_random_bytes(integer)') is null then
    raise exception 'ไม่พบ pgcrypto ใน schema extensions — ให้รันคำสั่งนี้ก่อน แล้วค่อยวางไฟล์นี้ใหม่: alter extension pgcrypto set schema extensions;';
  end if;

  -- เคยรันไฟล์ฉบับเก่า (1,524 บรรทัด) ไว้ไหม — ของเก่ามีฟังก์ชันที่เปิดให้คนนอก
  -- ตั้งร้านเองได้ และไฟล์นี้ไม่ลบอะไรทิ้ง ถ้าทับกันจะได้ของสองรุ่นอยู่ด้วยกัน
  if to_regnamespace('api') is not null
     or to_regclass('pos.pair_codes') is not null
     or to_regclass('pos.auth_attempts') is not null
     or to_regclass('pos.shops') is not null
     or to_regclass('pos.order_tickets') is not null then
    raise exception 'โปรเจกต์นี้มีของจากไฟล์ติดตั้งฉบับเก่าอยู่ ถ้าไม่มีข้อมูลจริงให้ล้างก่อนด้วย: drop schema if exists api cascade; drop schema if exists pos cascade; แล้วค่อยวางไฟล์นี้ใหม่';
  end if;
end
$pre$;


create schema if not exists pos;

-- ไม่ให้สิทธิ์ schema pos กับใครเลย: ลูกค้าแตะตารางตรงๆ ไม่ได้
-- ทางเข้าทางเดียวคือฟังก์ชัน public.pos_* ที่เป็น security definer
revoke all on schema pos from public;


-- ============================================================================
--  1. ตาราง
-- ============================================================================

/* เครื่องที่ผูกกับร้านแล้ว — คีย์คือ auth.uid() ของ anonymous session ตรงๆ
   ล้างข้อมูลเบราว์เซอร์ = เสีย session = ต้องผูกใหม่ด้วยรหัสใหม่ (ยอมรับได้) */
create table if not exists pos.devices (
  uid          uuid primary key,
  role         text        not null check (role in ('central', 'phone')),
  label        text        not null check (length(label) between 1 and 40),
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz,
  revoked_at   timestamptz
);

/* **ห้ามมีเครื่องกลาง 2 เครื่องพร้อมกัน** เครื่องกลางคือคนออกเลขบิลคนเดียว
   ถ้ามีสองเครื่อง เลขบิลจะซ้ำและสต็อกจะตัดซ้ำ — ซึ่งเป็นสิ่งที่สถาปัตยกรรม
   single writer ทั้งหมดมีไว้เพื่อกัน จึงบังคับที่ชั้นฐานข้อมูล ไม่ใช่ที่โค้ด */
create unique index if not exists devices_single_central
  on pos.devices (role) where role = 'central' and revoked_at is null;

/* รหัสผูกเครื่อง — เก็บเป็น sha256 ไม่เก็บตัวรหัส
   16 ตัวอักษรจากชุด 32 ตัว = 80 บิต · ใช้ครั้งเดียว · หมดอายุ 30 นาที
   เดาสุ่มต้องลอง ~6×10^23 ครั้งใน 30 นาที จึงไม่ต้องมีตัวนับครั้งผิด
   (ฉบับก่อนใช้เลข 6 หลักจาก random() = เดาถูกได้จริง และ random() ของ
    PostgreSQL ไม่ใช่ตัวสุ่มเชิงรหัสลับ ตามคู่มือของมันเอง) */
create table if not exists pos.enroll_codes (
  code_hash  bytea primary key,
  role       text        not null check (role in ('central', 'phone')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  used_at    timestamptz,
  used_by    uuid
);

/* ใบสั่งจากมือถือ — payload เก็บทั้งก้อนแบบไม่แกะ
   คลาวด์ไม่เคยอ่านข้างในเพื่อเอาไปคิดเงิน (ดูหัวไฟล์)

   สถานะ:
     pending  = รอเครื่องกลางมาออกบิล
     billed   = ออกบิลแล้ว (มี receipt_no)
     rejected = เครื่องกลางปฏิเสธ · **แก้แล้วส่งใหม่ด้วยรหัสเดิมได้**
                (ตรงกับ receiveTicket ที่ยอมออกบิลให้ใบที่เคยถูกปฏิเสธ)
     review   = ต้องให้คนมาดูด้วยมือ ห้ามส่งใหม่อัตโนมัติ
                ใช้กับเคส "อาจออกบิลไปแล้วแต่ไม่รู้" เช่นตอนเปลี่ยนเครื่องกลาง */
create table if not exists pos.tickets (
  ticket_uid text primary key check (length(ticket_uid) between 1 and 64),
  device_uid uuid        not null references pos.devices (uid),
  payload    jsonb       not null,
  state      text        not null default 'pending'
               check (state in ('pending', 'billed', 'rejected', 'review')),
  receipt_no text        check (receipt_no is null or length(receipt_no) <= 40),
  reason     text,
  resubmits  int         not null default 0,
  created_at timestamptz not null default now(),
  settled_at timestamptz
);

create index if not exists tickets_pending_idx
  on pos.tickets (created_at) where state = 'pending';

create index if not exists tickets_device_idx on pos.tickets (device_uid, state);

/* ที่จองไว้สำหรับรูปสลิป — แถวนี้คือสิ่งที่อนุญาตให้อัปโหลดไฟล์ได้
   (นโยบายของ Storage ถามตารางนี้ว่าชื่อไฟล์นี้จองไว้โดยเครื่องนี้จริงไหม)

   ticket_uid/table_label/amount เป็นร่องรอยอิสระตาม TABLE-ORDER-PLAN.md §17 ข้อ 3:
   ต้องตามได้ว่า "รับเงินโต๊ะไหนไปเท่าไร" แม้ใบสั่งจะหายทั้งใบ
   ไม่ผูก FK ไป pos.tickets เพราะรูปถูกอัปโหลดที่ขั้นที่ 4 ซึ่งมาก่อนการส่ง
   ใบสั่งที่ขั้นที่ 5 — ตอนจองรูป แถวใบสั่งยังไม่มีอยู่ */
create table if not exists pos.slips (
  slip_id     text primary key check (length(slip_id) between 1 and 64),
  object_name text        not null unique,
  device_uid  uuid        not null references pos.devices (uid),
  ticket_uid  text        not null check (length(ticket_uid) between 1 and 64),
  table_label text        not null check (length(table_label) between 1 and 40),
  amount      numeric(12, 2) not null,
  uploaded_at timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists slips_device_idx on pos.slips (device_uid, created_at desc);
create index if not exists slips_ticket_idx on pos.slips (ticket_uid);

/* แคตตาล็อกสินค้า + ค่าตั้งของร้าน ที่เครื่องกลาง push ขึ้นมาให้มือถือดึงไป

   **ทำไมคลาวด์ต้องรู้เรื่องนี้ ทั้งที่หัวไฟล์บอกว่ามันไม่คิดเงิน**
   เพราะ `Product.id` เป็น auto-increment ของ IndexedDB ของแต่ละเครื่อง
   มือถือที่เพิ่งเปิดแอปจะมีสินค้าตัวอย่างที่กิน id ชุดเดียวกันกับสินค้าจริง ⇒ ใบสั่งจะอ้างสินค้าผิดตัว
   แบบที่ด่านเทียบยอดเงินจับไม่ได้ (ดู src/lib/catalog.ts และ TABLE-ORDER-PLAN.md §21 ข้อ 1)
   คลาวด์เก็บก้อน jsonb ไว้เฉยๆ แล้วส่งคืนเมื่อมือถือขอ — เหมือนใบสั่ง
   ด่านที่ตรวจจริงคือ `validateTicket` ที่เครื่องกลาง ซึ่งเทียบ `catalogId` */
create table if not exists pos.config (
  key        text primary key check (key in ('catalog')),
  rev        text        not null check (length(rev) between 1 and 64),
  payload    jsonb       not null,
  updated_at timestamptz not null default now(),
  updated_by uuid        not null references pos.devices (uid)
);

-- RLS เปิดทุกตาราง และ **ไม่สร้าง policy เลย** = ไม่มีใครอ่านเขียนตรงๆ ได้
-- (คนที่เข้าถึงได้คือ security definer ซึ่งทำงานด้วยสิทธิ์เจ้าของ ไม่ผ่าน RLS)
alter table pos.devices      enable row level security;
alter table pos.enroll_codes enable row level security;
alter table pos.tickets      enable row level security;
alter table pos.slips        enable row level security;
alter table pos.config       enable row level security;


-- ============================================================================
--  2. ของใช้ภายใน (อยู่ใน schema pos — ลูกค้าเรียกไม่ได้)
-- ============================================================================

/* เวลาเป็นตัวเลขมิลลิวินาที ไม่ใช่สตริง ISO
   ฝั่งแอปเก็บเวลาเป็น number ทุกที่ (OrderTicket.createdAt ใน src/db/types.ts)
   ถ้าคืนเป็นสตริงแล้วเผลอเขียนลง Dexie ตรงๆ การเรียงจะผสมชนิดแล้วเพี้ยนเงียบๆ */
create or replace function pos.ms(p timestamptz) returns bigint
  language sql stable set search_path = '' as
$$ select case when p is null then null else (extract(epoch from p) * 1000)::bigint end $$;

/* ชุดตัวอักษรของรหัสผูกเครื่อง 32 ตัว ตัด 0 O 1 I ออกเพราะคนอ่านสลับกัน
   256 ÷ 32 = 8 ลงตัว จึงเอาไบต์สุ่ม mod 32 ได้โดยไม่ทำให้การแจกแจงเบ้ */
create or replace function pos.code_alphabet() returns text
  language sql immutable set search_path = '' as
$$ select '23456789ABCDEFGHJKLMNPQRSTUVWXYZ' $$;

/* ตัดขีด เว้นวรรค และตัวพิมพ์เล็ก ออกจากรหัสที่คนกรอกมา */
create or replace function pos.norm_code(p_code text) returns text
  language sql immutable set search_path = '' as
$$ select upper(regexp_replace(coalesce(p_code, ''), '[^0-9A-Za-z]', '', 'g')) $$;

create or replace function pos.code_hash(p_code text) returns bytea
  language sql stable set search_path = '' as
$$ select extensions.digest(pos.norm_code(p_code), 'sha256') $$;

/* ออกรหัสผูกเครื่องใหม่ — **เรียกจากหน้าเว็บ Supabase เท่านั้น**
   ไม่เปิดให้ลูกค้าเรียก เพราะ role 'central' ต้องมาจากเจ้าของร้านจริงๆ
   (เครื่องกลางออกรหัสของมือถือได้เอง ผ่าน public.pos_mint_phone_code) */
create or replace function pos.new_enroll_code(p_role text, p_minutes int default 30)
  returns text language plpgsql security definer set search_path = '' as
$$
declare
  v_bytes bytea;
  v_code  text := '';
  v_abc   text := pos.code_alphabet();
  i       int;
begin
  if p_role not in ('central', 'phone') then
    raise exception 'บทบาทต้องเป็น central หรือ phone เท่านั้น (ได้มา: %)', p_role;
  end if;
  if p_minutes is null or p_minutes < 1 or p_minutes > 1440 then
    raise exception 'อายุรหัสต้องอยู่ระหว่าง 1 ถึง 1440 นาที';
  end if;

  v_bytes := extensions.gen_random_bytes(16);
  for i in 0 .. 15 loop
    v_code := v_code || substr(v_abc, (get_byte(v_bytes, i) % 32) + 1, 1);
  end loop;

  insert into pos.enroll_codes (code_hash, role, expires_at)
  values (pos.code_hash(v_code), p_role, now() + make_interval(mins => p_minutes));

  -- คืนแบบมีขีดให้อ่าน/กรอกง่าย ตอนตรวจจะตัดขีดออกให้เอง
  return substr(v_code, 1, 4) || '-' || substr(v_code, 5, 4) || '-'
      || substr(v_code, 9, 4) || '-' || substr(v_code, 13, 4);
end
$$;

/* ด่านหน้าของทุกฟังก์ชัน: เครื่องนี้ผูกกับร้านแล้วจริงไหม และบทบาทถูกไหม
   คืนแถว device กลับไปให้ผู้เรียกใช้ต่อ

   รหัส error แยกกันเพราะหน้าจอต้องทำคนละอย่าง: POS01 = ให้กรอกรหัสผูกเครื่อง
   POS02 = เครื่องนี้ถูกถอนสิทธิ์ ให้ไปถามผู้จัดการ (กรอกรหัสเองไม่ช่วย)
   ทั้งสองข้อความบอกแต่สถานะของผู้เรียกเอง ไม่ได้บอกอะไรเกี่ยวกับเครื่องอื่น */
create or replace function pos.require_device(p_role text default null)
  returns pos.devices language plpgsql stable security definer set search_path = '' as
$$
declare
  v_uid uuid := auth.uid();
  v_dev pos.devices;
begin
  if v_uid is null then
    raise exception 'ยังไม่ได้เข้าสู่ระบบคลาวด์ (ไม่มี session)' using errcode = 'POS00';
  end if;

  select * into v_dev from pos.devices where uid = v_uid;

  if not found then
    raise exception 'เครื่องนี้ยังไม่ได้ผูกกับร้าน — ขอรหัสผูกเครื่องจากเครื่องกลาง'
      using errcode = 'POS01';
  end if;
  if v_dev.revoked_at is not null then
    raise exception 'เครื่องนี้ถูกถอนสิทธิ์แล้ว — ต้องให้ผู้จัดการผูกใหม่'
      using errcode = 'POS02';
  end if;
  if p_role is not null and v_dev.role <> p_role then
    raise exception 'เครื่องนี้ไม่มีสิทธิ์ทำรายการนี้ (เป็น % แต่ต้องเป็น %)', v_dev.role, p_role
      using errcode = 'POS03';
  end if;

  return v_dev;
end
$$;

/* ล้างของเก่า — เรียกจากหน้าเว็บ Supabase
   ลบเฉพาะใบสั่งที่ปิดเรื่องแล้ว (billed/rejected) ของที่ยัง pending หรือ review
   ไม่ลบทิ้ง เพราะสองสถานะนั้น = เงินเข้าแล้วแต่ยังไม่จบเรื่อง ต้องมีคนมาดู

   **ไม่แตะ storage.objects เลย** และไม่ลบแถวของรูปที่อัปโหลดขึ้นไปแล้ว:
   การลบแถวใน storage.objects ด้วย SQL ตรงๆ ลบแต่ทะเบียน ไฟล์จริงยังอยู่ใน
   ที่เก็บและยังกินโควตา ⇒ จะได้ไฟล์ลอยที่ไม่มีอะไรบอกว่าของโต๊ะไหน ซึ่งแย่กว่า
   ปล่อยแถวเล็กๆ ไว้ (แถวหนึ่งไม่ถึง 200 ไบต์) การลบไฟล์จริงต้องทำผ่าน Storage API
   (เครื่องกลางมีนโยบายลบอยู่แล้ว) หรือหน้า Storage ของ Supabase
   ที่ลบได้คือ **ใบจองที่ไม่เคยมีไฟล์** (uploaded_at ว่าง และเลยอายุใบจองแล้ว) */
create or replace function pos.purge(p_days int default 90)
  returns jsonb language plpgsql security definer set search_path = '' as
$$
declare
  v_cut     timestamptz;
  v_tickets int := 0;
  v_slips   int := 0;
  v_codes   int := 0;
  v_users   int := 0;
  v_note    text;
begin
  if p_days is null or p_days < 1 then
    raise exception 'จำนวนวันต้องมากกว่า 0';
  end if;
  v_cut := now() - make_interval(days => p_days);

  delete from pos.slips s
   where s.uploaded_at is null
     and s.created_at < now() - make_interval(hours => pos.slip_reserve_hours() * 2);
  get diagnostics v_slips = row_count;

  delete from pos.tickets
   where state in ('billed', 'rejected') and coalesce(settled_at, created_at) < v_cut;
  get diagnostics v_tickets = row_count;

  delete from pos.enroll_codes where expires_at < now() - make_interval(days => 1);
  get diagnostics v_codes = row_count;

  /* ล้างผู้ใช้ชั่วคราวที่ไม่ได้ผูกเป็นเครื่องของร้าน
     ทุกการล็อกอินแบบไม่ระบุตัวตนเขียนแถวลง auth.users และนั่นคือสิ่งเดียวที่
     คนนอกทำได้โดยยังไม่มีรหัส ถ้าไม่เก็บกวาด โควตาผู้ใช้/พื้นที่จะถูกถมได้
     เว้นทุก uid ที่เป็นเครื่องของร้านไว้แน่นอน */
  begin
    if to_regclass('auth.users') is not null
       and exists (
         select 1 from pg_attribute
          where attrelid = 'auth.users'::regclass
            and attname = 'is_anonymous' and not attisdropped
       ) then
      delete from auth.users u
       where u.is_anonymous
         and u.created_at < now() - make_interval(days => 2)
         and not exists (select 1 from pos.devices d where d.uid = u.id);
      get diagnostics v_users = row_count;
    end if;
  exception when others then
    -- ส่งเหตุผลกลับเป็นผลลัพธ์ให้เห็น ไม่ใช่ raise notice ที่ SQL Editor ไม่โชว์
    v_note := 'ล้างผู้ใช้ชั่วคราวไม่สำเร็จ: ' || sqlerrm;
  end;

  return jsonb_build_object(
    'tickets', v_tickets, 'slips', v_slips, 'codes', v_codes,
    'anonUsers', v_users, 'note', v_note
  );
end
$$;


-- ============================================================================
--  3. เพดานกันโควตาเต็ม (ไม่ใช่ด่านตรวจเงิน)
--
--  ฉบับก่อนจำกัด 20 ใบ/ชั่วโมง ซึ่ง (ก) ตันจริงตอนเที่ยง และ (ข) ปฏิเสธ
--  **หลังลูกค้าจ่ายเงินไปแล้ว** = ร้านได้เงินแต่ไม่มีบิล ซึ่งแย่กว่าโควตาเต็ม
--
--  ของใหม่:
--   * เพดานนับ **ต่อเครื่อง** ไม่ใช่ทั้งร้าน — เครื่องเดียวที่ถูกขโมยหรือโค้ดวนลูป
--     จะต้องไม่ทำให้ทุกเครื่องส่งใบสั่งไม่ได้
--   * ตัวเลขสูงพอที่ร้านจริงไม่มีทางถึง (ร้านนี้ไม่เกิน 50 บิล/วันทั้งร้าน
--     200 ใบค้างของเครื่องเดียว = เครื่องกลางไม่ได้เปิดมาหลายวันแล้ว)
--   * ก่อนถึงเพดาน จะ **รับใบไว้แล้วคืนจำนวนใบค้าง (backlog)** ให้หน้าจอเตือน
--     แทนการปฏิเสธ — เงินเข้ากระเป๋าร้านไปแล้ว การไม่เก็บใบสั่งไม่ได้ช่วยอะไร
-- ============================================================================

create or replace function pos.max_pending_per_device() returns int
  language sql immutable set search_path = '' as $$ select 200 $$;

/* เพดานของก้อนแคตตาล็อก — ร้าน 500 รายการ×~400 ไบต์ = 200KB
   รูปสินค้าไม่อยู่ในก้อนนี้อยู่แล้ว (stripProduct ใน src/lib/catalog.ts) */
create or replace function pos.max_config_bytes() returns int
  language sql immutable set search_path = '' as $$ select 2097152 $$;

create or replace function pos.max_payload_bytes() returns int
  language sql immutable set search_path = '' as $$ select 65536 $$;

/* เพดานจำนวนใบจองรูปสลิปต่อเครื่องต่อวัน
   นับ "ที่จองในรอบ 24 ชม." ไม่ใช่ "ที่ยังไม่อัปโหลด" — ตัวหลังรีเซ็ตตัวเองได้
   เพราะเครื่องเป็นคนบอกเองว่าอัปโหลดแล้ว (จอง 200 → แจ้งว่าส่งแล้ว → จองใหม่ไม่จำกัด) */
create or replace function pos.max_slips_per_day() returns int
  language sql immutable set search_path = '' as $$ select 200 $$;

/* อายุของใบจองรูปสลิป — เป็นใบอนุญาตอัปโหลดแบบใช้ครั้งเดียวและมีวันหมดอายุ
   ไม่ใช่สิทธิ์เขียนถาวร · 2 วันเผื่อมือถือออกจากพื้นที่เน็ตไปทั้งวัน */
create or replace function pos.slip_reserve_hours() returns int
  language sql immutable set search_path = '' as $$ select 48 $$;


-- ============================================================================
--  4. ทางเข้าของแอป (public.pos_* — ลูกค้าเรียกผ่าน rpc ได้)
--
--  รหัส error (อ่านจาก error.code ฝั่งแอป ห้ามจับคู่ด้วยข้อความไทย
--  เพราะข้อความถูกแก้คำได้ตลอด):
--    POS00 ยังไม่ล็อกอินคลาวด์      POS01 เครื่องนี้ยังไม่ได้ผูก
--    POS02 เครื่องนี้ถูกถอนสิทธิ์    POS03 บทบาทไม่ถูก (ไม่ใช่เครื่องกลาง)
--    POS05 รหัสผูกเครื่องไม่ถูก/หมดอายุ
--    POS06 ข้อมูลที่ส่งมาไม่ถูกต้อง (ลองใหม่เหมือนเดิมไม่มีประโยชน์)
--    POS07 ชนเพดาน (ลองใหม่ทีหลังได้)
--    POS08 ชนกับของที่มีอยู่ ต้องมีคนมาดู (ลองใหม่ไม่ช่วย)
-- ============================================================================

/* เครื่องนี้เป็นใคร — ใช้ตัดสินว่าจะโผล่หน้า "กรอกรหัสผูกเครื่อง" ไหม
   เรียกได้แม้ยังไม่ผูก จึงไม่ผ่าน require_device */
create or replace function public.pos_whoami()
  returns jsonb language plpgsql stable security definer set search_path = '' as
$$
declare
  v_uid uuid := auth.uid();
  v_dev pos.devices;
begin
  if v_uid is null then
    return jsonb_build_object('signedIn', false, 'bound', false,
                              'serverTime', pos.ms(now()));
  end if;

  select * into v_dev from pos.devices where uid = v_uid;

  if not found then
    return jsonb_build_object('signedIn', true, 'bound', false,
                              'serverTime', pos.ms(now()));
  end if;

  return jsonb_build_object(
    'signedIn',   true,
    'bound',      v_dev.revoked_at is null,
    'role',       v_dev.role,
    'label',      v_dev.label,
    'revoked',    v_dev.revoked_at is not null,
    'serverTime', pos.ms(now())
  );
end
$$;

/* ผูกเครื่องด้วยรหัส — ฟังก์ชันเดียวที่เรียกได้ตอนยังไม่ผูก
   ข้อความ error ไม่บอกว่า "รหัสผิด" หรือ "หมดอายุ" แยกกัน เพื่อไม่ให้
   คนเดาใช้ผลต่างของข้อความมาไล่หารหัสที่เคยมีอยู่จริง */
create or replace function public.pos_claim_enroll(p_code text, p_label text)
  returns jsonb language plpgsql security definer set search_path = '' as
$$
declare
  v_uid     uuid := auth.uid();
  v_label   text := nullif(btrim(coalesce(p_label, '')), '');
  v_code    pos.enroll_codes;
  v_flagged int := 0;
begin
  if v_uid is null then
    raise exception 'ยังไม่ได้เข้าสู่ระบบคลาวด์ (ไม่มี session)' using errcode = 'POS00';
  end if;
  if v_label is null then
    raise exception 'ต้องตั้งชื่อเครื่องก่อน เช่น "มือถือ A" หรือ "เครื่องเคาน์เตอร์"'
      using errcode = 'POS06';
  end if;
  v_label := left(v_label, 40);

  -- ล็อกแถวรหัสไว้ กันสองเครื่องกรอกรหัสเดียวกันพร้อมกันแล้วผูกได้ทั้งคู่
  select * into v_code from pos.enroll_codes
   where code_hash = pos.code_hash(p_code)
     for update;

  if not found or v_code.used_at is not null or v_code.expires_at < now() then
    raise exception 'รหัสผูกเครื่องไม่ถูกต้องหรือหมดอายุแล้ว — ขอรหัสใหม่จากเครื่องกลาง'
      using errcode = 'POS05';
  end if;

  update pos.enroll_codes
     set used_at = now(), used_by = v_uid
   where code_hash = v_code.code_hash;

  /* รหัสของเครื่องกลางมาจากเจ้าของร้านที่หน้าเว็บ Supabase เท่านั้น
     จึงถือเป็นคำสั่ง "ย้ายเครื่องกลางมาที่เครื่องนี้" ได้เลย — และนี่คือ
     ทางกู้คืนตอนเครื่องกลางหาย ตัวเก่าต้องถูกถอนสิทธิ์ในทรานแซกชันเดียวกัน
     ไม่งั้น unique index devices_single_central จะปฏิเสธการผูก */
  if v_code.role = 'central' then
    update pos.devices
       set revoked_at = now()
     where role = 'central' and revoked_at is null and uid <> v_uid;

    /* **ใบที่ยังค้างต้องไม่ถูกเครื่องใหม่ดึงไปทำต่ออัตโนมัติ**
       เครื่องเก่าอาจออกบิลไปแล้วแต่ยังไม่ทันแจ้งกลับ (ด่านกันบิลซ้ำตัวจริงอยู่ใน
       IndexedDB ของเครื่องเก่า) ถ้าเครื่องใหม่หยิบไปออกบิล จะได้บิลใบที่สองของ
       เงินก้อนเดิม เลขบิลกิน 2 ชุด สต็อกตัด 2 รอบ แต้มตัด 2 รอบ
       เลือกข้าง "ต้องมีคนมาดู" แทน "อาจออกบิลซ้ำเงียบๆ" */
    update pos.tickets
       set state = 'review',
           reason = 'เปลี่ยนเครื่องกลาง — ต้องตรวจด้วยมือว่าใบนี้ออกบิลไปแล้วหรือยัง',
           settled_at = now()
     where state = 'pending';
    get diagnostics v_flagged = row_count;
  end if;

  begin
    insert into pos.devices (uid, role, label)
    values (v_uid, v_code.role, v_label)
    on conflict (uid) do update
       set role = excluded.role, label = excluded.label, revoked_at = null;
  exception when unique_violation then
    -- ชน devices_single_central: มีคนผูกเครื่องกลางพร้อมกันอีกเครื่อง
    raise exception 'มีเครื่องอื่นกำลังผูกเป็นเครื่องกลางพร้อมกัน — รอสักครู่แล้วลองใหม่'
      using errcode = 'POS08';
  end;

  return jsonb_build_object('role', v_code.role, 'label', v_label,
                            'ticketsFlagged', v_flagged);
end
$$;

/* เครื่องกลางออกรหัสให้มือถือ — ไม่มีพารามิเตอร์ role โดยเจตนา
   ฉบับก่อนรับ role มาจากผู้เรียก ซึ่งเปิดทางให้มือถือออกรหัสเครื่องกลางให้ตัวเอง */
create or replace function public.pos_mint_phone_code(p_minutes int default 30)
  returns text language plpgsql security definer set search_path = '' as
$$
begin
  perform pos.require_device('central');
  return pos.new_enroll_code('phone', least(greatest(coalesce(p_minutes, 30), 1), 120));
end
$$;

create or replace function public.pos_list_devices()
  returns table (uid uuid, role text, label text, last_seen_ms bigint, revoked_ms bigint,
                 pending_tickets int)
  language plpgsql stable security definer set search_path = '' as
$$
begin
  perform pos.require_device('central');
  return query
    select d.uid, d.role, d.label, pos.ms(d.last_seen_at), pos.ms(d.revoked_at),
           (select count(*)::int from pos.tickets t
             where t.device_uid = d.uid and t.state = 'pending')
      from pos.devices d order by d.role, d.created_at;
end
$$;

create or replace function public.pos_revoke_device(p_uid uuid)
  returns jsonb language plpgsql security definer set search_path = '' as
$$
declare
  v_me pos.devices := pos.require_device('central');
  v_n  int;
begin
  if p_uid is null then
    raise exception 'ต้องระบุเครื่องที่จะถอนสิทธิ์' using errcode = 'POS06';
  end if;
  if p_uid = v_me.uid then
    raise exception 'ถอนสิทธิ์เครื่องกลางจากตัวมันเองไม่ได้ — ถ้าจะย้ายเครื่องกลาง ให้ออกรหัส central ใหม่ที่หน้าเว็บ Supabase'
      using errcode = 'POS06';
  end if;

  update pos.devices set revoked_at = now()
   where uid = p_uid and revoked_at is null;
  get diagnostics v_n = row_count;

  return jsonb_build_object('revoked', v_n);
end
$$;

create or replace function public.pos_heartbeat()
  returns jsonb language plpgsql security definer set search_path = '' as
$$
declare
  v_dev pos.devices := pos.require_device();
begin
  update pos.devices set last_seen_at = now() where uid = v_dev.uid;
  return jsonb_build_object('role', v_dev.role, 'serverTime', pos.ms(now()));
end
$$;


-- ----------------------------------------------------------------------------
--  ใบสั่ง
-- ----------------------------------------------------------------------------

/* ส่งใบสั่งขึ้นคลาวด์ — **กดซ้ำได้ ไม่เกิดใบที่สอง** (คีย์คือ ticket_uid)
   คลาวด์ไม่แกะ payload ไปคิดเงิน แต่ **ห้ามให้แก้ payload ของใบที่ยังค้างอยู่**
   ไม่งั้นมือถือส่งซ้ำด้วยรายการใหม่แล้วบิลกับของที่กินไปจะไม่ตรงกัน

   `changed` เทียบ payload แบบ **ตัด verifiedAt กับ actor ออกก่อน**
   สองฟิลด์นั้นขยับได้ทุกครั้งที่กดซ้ำโดยที่ออเดอร์ไม่ได้เปลี่ยนอะไร
   ถ้าไม่ตัดออก การกดส่งซ้ำตอนเน็ตหลุด (ซึ่ง §17 บังคับให้ทำได้) จะได้
   changed = true ทุกครั้ง = คำเตือนปลอมที่ผลักให้พนักงานไปตีบิลใหม่
   แล้วเงินก้อนเดียวจะมีบิล 2 ใบ

   ใบที่ถูกปฏิเสธ (rejected) **ส่งใหม่ด้วยรหัสเดิมได้** และ payload จะถูกแทนที่
   ต้องเป็นแบบนี้เพราะ receiveTicket ฝั่งเครื่องกลางยอมออกบิลให้ใบที่เคยถูก
   ปฏิเสธ (มีเทสต์คุมอยู่ใน src/lib/tableOrderIntake.test.ts) ถ้าคลาวด์ไม่ยอม
   ทางเดียวที่เหลือคือสร้างรหัสใบใหม่ ซึ่งทิ้งเกราะกันบิลซ้ำทั้งหมด
   ส่วนใบสถานะ review ส่งใหม่ไม่ได้ — ต้องให้คนมาดูก่อน */
create or replace function public.pos_submit_ticket(p_ticket_uid text, p_payload jsonb)
  returns jsonb language plpgsql security definer set search_path = '' as
$$
declare
  v_dev     pos.devices := pos.require_device();
  v_uid     text := nullif(btrim(coalesce(p_ticket_uid, '')), '');
  v_old     pos.tickets;
  v_mine    int;
  v_backlog int;
begin
  if v_uid is null or length(v_uid) > 64 then
    raise exception 'รหัสใบสั่งไม่ถูกต้อง (ต้องมีและยาวไม่เกิน 64 ตัว)' using errcode = 'POS06';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'เนื้อใบสั่งต้องเป็นวัตถุ JSON' using errcode = 'POS06';
  end if;
  if octet_length(p_payload::text) > pos.max_payload_bytes() then
    raise exception 'ใบสั่งใหญ่เกิน % ไบต์ — รายการเยอะผิดปกติ ให้แยกเป็นสองใบ',
      pos.max_payload_bytes() using errcode = 'POS06';
  end if;

  select count(*)::int into v_backlog from pos.tickets where state = 'pending';

  select * into v_old from pos.tickets where ticket_uid = v_uid;

  if not found then
    select count(*)::int into v_mine
      from pos.tickets where device_uid = v_dev.uid and state = 'pending';
    if v_mine >= pos.max_pending_per_device() then
      raise exception 'เครื่องนี้มีใบสั่งค้างไม่ออกบิลถึง % ใบ — เครื่องกลางไม่ได้เปิดมานานแล้ว ให้ไปดูที่เคาน์เตอร์ก่อน',
        v_mine using errcode = 'POS07';
    end if;

    /* on conflict do nothing แทนการ select ก่อนแล้ว insert — มือถือกดส่งสองครั้ง
       ติดกัน (เน็ตอืดแล้วกดใหม่) ทำให้ทั้งสองคำขอผ่านด่าน select พร้อมกันได้
       ตัวที่สองจะชน unique แล้วโยน error ดิบๆ ซึ่งหน้าจอแปลไม่ออก */
    insert into pos.tickets (ticket_uid, device_uid, payload)
    values (v_uid, v_dev.uid, p_payload)
    on conflict (ticket_uid) do nothing;

    if found then
      return jsonb_build_object('accepted', true, 'duplicate', false,
                                'state', 'pending', 'backlog', v_backlog + 1);
    end if;

    -- แพ้การแข่งขัน: อีกคำขอ insert ไปก่อน อ่านของจริงมาตอบ
    select * into v_old from pos.tickets where ticket_uid = v_uid;
  end if;

  /* ใบนี้มีอยู่แล้ว — **ต้องเช็คเจ้าของก่อนตอบอะไรออกไป**
     ถ้าไม่เช็ค เครื่องที่ผูกแล้วเครื่องใดก็อ่านสถานะ เลขบิล และเหตุผลของใบที่
     เครื่องอื่นส่งได้ (pos_ticket_state เช็คอยู่ ตัวนี้จึงเป็นทางอ้อมของข้อมูลเดียวกัน)
     และ `changed` ยังเป็นเครื่องมือเทียบ payload ทีละใบให้คนนอกด้วย */
  if v_dev.role <> 'central' and v_old.device_uid <> v_dev.uid then
    raise exception 'รหัสใบสั่งนี้ถูกใช้โดยเครื่องอื่นแล้ว — ให้เริ่มใบใหม่'
      using errcode = 'POS08';
  end if;

  if v_old.state = 'rejected' then
    update pos.tickets
       set payload = p_payload, state = 'pending', reason = null, receipt_no = null,
           settled_at = null, resubmits = resubmits + 1
     where ticket_uid = v_uid;
    return jsonb_build_object('accepted', true, 'duplicate', false, 'resubmitted', true,
                              'state', 'pending', 'backlog', v_backlog + 1);
  end if;

  return jsonb_build_object(
    'accepted',  false,
    'duplicate', true,
    'changed',   (v_old.payload - 'verifiedAt' - 'actor')
                 <> (p_payload - 'verifiedAt' - 'actor'),
    'state',     v_old.state,
    'receiptNo', v_old.receipt_no,
    'reason',    v_old.reason,
    'backlog',   v_backlog
  );
end
$$;

/* มือถือถามว่าใบสั่งที่ส่งไปออกบิลแล้วหรือยัง

   **แยก "ไม่มีใบนี้" ออกจาก "มีแต่ไม่ใช่ของเครื่องนี้"** เพราะ session ของ
   anonymous หายได้ (iOS ล้าง site data) แล้วเครื่องเดิมจะได้ auth.uid() ใหม่
   ถ้าตอบ found:false เหมือนกันทั้งสองกรณี พนักงานจะเชื่อว่าออเดอร์ไม่ถึงคลาวด์
   แล้วไปตีบิลใหม่ = บิล 2 ใบของเงินก้อนเดียว
   เครื่องที่ไม่ใช่เจ้าของจะได้แค่สถานะ ไม่ได้เลขบิลหรือเหตุผล */
create or replace function public.pos_ticket_state(p_ticket_uid text)
  returns jsonb language plpgsql stable security definer set search_path = '' as
$$
declare
  v_dev  pos.devices := pos.require_device();
  v_t    pos.tickets;
  v_mine boolean;
begin
  select * into v_t from pos.tickets where ticket_uid = p_ticket_uid;
  if not found then
    return jsonb_build_object('found', false);
  end if;

  v_mine := v_dev.role = 'central' or v_t.device_uid = v_dev.uid;

  if not v_mine then
    return jsonb_build_object('found', true, 'mine', false, 'state', v_t.state);
  end if;

  return jsonb_build_object(
    'found',     true,
    'mine',      true,
    'state',     v_t.state,
    'receiptNo', v_t.receipt_no,
    'reason',    v_t.reason,
    'createdAt', pos.ms(v_t.created_at)
  );
end
$$;

/* เครื่องกลางดึงใบที่ยังไม่ออกบิล
   **ไม่มีการจอง/ล็อกใบ** โดยเจตนา — มีเครื่องกลางได้เครื่องเดียว (unique index)
   และถ้าเครื่องกลางดับหลังออกบิลแต่ยังไม่ทันแจ้งกลับ รอบถัดไปจะได้ใบเดิมมาอีก
   ซึ่ง receiveTicket() มีด่านกันบิลซ้ำอยู่แล้ว (คืนบิลใบเดิมพร้อม duplicate: true)
   แล้วค่อยแจ้งกลับ — การไม่มีกลไกจองคือสิ่งที่ทำให้กู้สถานะได้เองโดยไม่ต้องมี lease

   **ด่านนั้นอยู่ในตาราง orderTickets ของเครื่องกลาง** ซึ่งต้องอยู่ในไฟล์สำรอง
   (ดู TABLES ใน src/lib/backup.ts) ไม่งั้นการกู้เครื่องจากไฟล์สำรองจะทำให้ด่านหาย
   ส่วนการ "เปลี่ยนเครื่องกลาง" ตีใบที่ค้างเป็น review ไปแล้วที่ pos_claim_enroll */
create or replace function public.pos_pending_tickets(p_limit int default 50)
  returns table (ticket_uid text, payload jsonb, device_label text, device_uid uuid,
                 resubmits int, created_ms bigint)
  language plpgsql stable security definer set search_path = '' as
$$
begin
  perform pos.require_device('central');
  return query
    select t.ticket_uid, t.payload, d.label, t.device_uid, t.resubmits,
           pos.ms(t.created_at)
      from pos.tickets t
      join pos.devices d on d.uid = t.device_uid
     where t.state = 'pending'
     order by t.created_at
     limit least(greatest(coalesce(p_limit, 50), 1), 200);
end
$$;

/* เครื่องกลางแจ้งผล: ออกบิลแล้ว / ปฏิเสธ / ต้องให้คนมาดู
   แจ้งซ้ำด้วยผลเดิมได้ (เน็ตหลุดแล้วส่งใหม่) แต่ **แจ้งทับผลที่ปิดเรื่องไปแล้ว
   ด้วยผลอื่นจะถูกปฏิเสธ** เพราะนั่นหมายถึงใบสั่งเดียวมีสองคำตัดสิน ซึ่งต้องมีคนมาดู
   ถ้าจะแก้จริงๆ (เช่น void บิลแล้วออกใหม่) ทำที่หน้าเว็บ Supabase

   ใบที่ถูกปฏิเสธกลับมาเป็น pending ได้ทางเดียวคือมือถือส่งใหม่ (pos_submit_ticket)
   ไม่ใช่ทางนี้ — ไม่งั้นเครื่องกลางจะพาใบที่ปิดเรื่องแล้วกลับมาออกบิลได้เอง */
create or replace function public.pos_settle_ticket(
  p_ticket_uid text,
  p_state      text,
  p_receipt_no text default null,
  p_reason     text default null
) returns jsonb language plpgsql security definer set search_path = '' as
$$
declare
  v_t   pos.tickets;
  v_rcp text := left(nullif(btrim(coalesce(p_receipt_no, '')), ''), 40);
  v_rsn text := left(nullif(btrim(coalesce(p_reason, '')), ''), 400);
begin
  perform pos.require_device('central');

  if p_state not in ('billed', 'rejected', 'review') then
    raise exception 'สถานะต้องเป็น billed, rejected หรือ review (ได้มา: %)', p_state
      using errcode = 'POS06';
  end if;
  if p_state = 'billed' and v_rcp is null then
    raise exception 'แจ้งว่าออกบิลแล้วต้องมีเลขบิลมาด้วย' using errcode = 'POS06';
  end if;
  if p_state <> 'billed' and v_rsn is null then
    raise exception 'แจ้งว่าไม่ออกบิลต้องบอกเหตุผลมาด้วย (หน้าจอมือถือจะโชว์ให้พนักงาน)'
      using errcode = 'POS06';
  end if;

  select * into v_t from pos.tickets where ticket_uid = p_ticket_uid for update;
  if not found then
    raise exception 'ไม่พบใบสั่งรหัส %', p_ticket_uid using errcode = 'POS06';
  end if;

  if v_t.state <> 'pending' then
    if v_t.state = p_state and coalesce(v_t.receipt_no, '') = coalesce(v_rcp, '') then
      return jsonb_build_object('state', v_t.state, 'receiptNo', v_t.receipt_no,
                                'duplicate', true);
    end if;
    raise exception 'ใบสั่ง % ปิดเรื่องไปแล้ว (สถานะ % เลขบิล %) — แจ้งทับด้วยผลอื่นไม่ได้',
      p_ticket_uid, v_t.state, coalesce(v_t.receipt_no, '-') using errcode = 'POS08';
  end if;

  update pos.tickets
     set state      = p_state,
         receipt_no = case when p_state = 'billed' then v_rcp end,
         reason     = v_rsn,
         settled_at = now()
   where ticket_uid = p_ticket_uid;

  return jsonb_build_object('state', p_state, 'receiptNo', v_rcp, 'duplicate', false);
end
$$;

/* เครื่องกลางตีใบค้างของเครื่องหนึ่งเป็น review ทีเดียวทั้งก้อน
   มีไว้เพื่อให้ระบายคิวได้ในแอป ไม่ต้องเปิด SQL Editor — ถอนสิทธิ์มือถือ
   ไม่ได้ล้างใบที่มันส่งไว้ (ใบค้างไม่เคยถูก purge โดยเจตนา) ถ้าไม่มีทางนี้
   เครื่องที่พังแล้วยิงใบขยะไว้จะทำให้ตัวเองส่งใบจริงไม่ได้อีกเลย */
create or replace function public.pos_review_device_tickets(p_uid uuid, p_reason text)
  returns jsonb language plpgsql security definer set search_path = '' as
$$
declare
  v_rsn text := left(nullif(btrim(coalesce(p_reason, '')), ''), 400);
  v_n   int;
begin
  perform pos.require_device('central');
  if p_uid is null or v_rsn is null then
    raise exception 'ต้องระบุเครื่องและเหตุผล' using errcode = 'POS06';
  end if;

  update pos.tickets
     set state = 'review', reason = v_rsn, settled_at = now()
   where device_uid = p_uid and state = 'pending';
  get diagnostics v_n = row_count;

  return jsonb_build_object('flagged', v_n);
end
$$;


-- ----------------------------------------------------------------------------
--  แคตตาล็อกสินค้า (เครื่องกลาง push → มือถือ pull)
-- ----------------------------------------------------------------------------

/* เครื่องกลางส่งแคตตาล็อกขึ้นไป

   เขียนทับก้อนเดิมทั้งก้อน (ไม่เก็บประวัติ) — แคตตาล็อกรุ่นก่าไม่มีประโยชน์
   กับใคร และการเก็บไว้ขยายโควตาเปล่าๆ · รหัสสินค้าเก่าอยู่ในบิลที่ออกไปแล้ว */
create or replace function public.pos_put_config(p_key text, p_rev text, p_payload jsonb)
  returns jsonb language plpgsql security definer set search_path = '' as
$$
declare
  v_dev pos.devices := pos.require_device('central');
  v_rev text := nullif(btrim(coalesce(p_rev, '')), '');
begin
  if p_key <> 'catalog' then
    raise exception 'รองรับเฉพาะ key = catalog (ได้มา: %)', p_key using errcode = 'POS06';
  end if;
  if v_rev is null or length(v_rev) > 64 then
    raise exception 'ต้องมีรุ่นของแคตตาล็อก (ยาวไม่เกิน 64 ตัว)' using errcode = 'POS06';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'แคตตาล็อกต้องเป็นวัตถุ JSON' using errcode = 'POS06';
  end if;
  if octet_length(p_payload::text) > pos.max_config_bytes() then
    raise exception 'แคตตาล็อกใหย่เกิน % ไบต์ — ตรวจว่ามีรูปสินค้าติดมาด้วยหรือเปล่า',
      pos.max_config_bytes() using errcode = 'POS06';
  end if;

  insert into pos.config (key, rev, payload, updated_by)
  values ('catalog', v_rev, p_payload, v_dev.uid)
  on conflict (key) do update
     set rev = excluded.rev, payload = excluded.payload,
         updated_at = now(), updated_by = excluded.updated_by;

  return jsonb_build_object('key', 'catalog', 'rev', v_rev, 'updatedMs', pos.ms(now()));
end
$$;

/* มือถือดึงแคตตาล็อก

   ส่ง p_known_rev มาด้วยเพื่อเช็คว่ามีอะไรใหม่ไหม ถ้ารุ่นเดิม จะคืนแค่ธง
   ไม่ส่งก้อนหนักกลับมา — มือถือเปิดหน้านี้ค้างทั้งกะ ถ้าดึงก้อนเต็มทุกรอบ
   จะกินโควตาเน็ตฟรีโดยเปล่า */
create or replace function public.pos_get_config(p_key text, p_known_rev text default null)
  returns jsonb language plpgsql stable security definer set search_path = '' as
$$
declare
  v_c pos.config;
begin
  perform pos.require_device();

  if p_key <> 'catalog' then
    raise exception 'รองรับเฉพาะ key = catalog (ได้มา: %)', p_key using errcode = 'POS06';
  end if;

  select * into v_c from pos.config where key = 'catalog';
  if not found then
    return jsonb_build_object('found', false);
  end if;
  if p_known_rev is not null and p_known_rev = v_c.rev then
    return jsonb_build_object('found', true, 'changed', false, 'rev', v_c.rev,
                              'updatedMs', pos.ms(v_c.updated_at));
  end if;

  return jsonb_build_object('found', true, 'changed', true, 'rev', v_c.rev,
                            'payload', v_c.payload, 'updatedMs', pos.ms(v_c.updated_at));
end
$$;


-- ----------------------------------------------------------------------------
--  รูปสลิป
-- ----------------------------------------------------------------------------

/* จองชื่อไฟล์ก่อนอัปโหลด — แถวนี้คือใบอนุญาตที่นโยบาย Storage จะไปถาม
   ทำเป็นสองจังหวะ (จอง → อัปโหลด) เพราะนโยบายของ Storage เขียนเงื่อนไข
   ซับซ้อนไม่ได้ และเราไม่อยากให้เครื่องไหนอัปโหลดชื่ออะไรก็ได้ตามใจ

   **เลขโต๊ะ ยอดเงิน และรหัสใบสั่ง บังคับต้องมี** ตามลำดับใน §18 ยอดถูกล็อก
   ที่ขั้นที่ 3 และเลขโต๊ะรู้ตั้งแต่ขั้นที่ 1 ⇒ ตอนถ่ายรูปที่ขั้นที่ 4 ต้องมีครบแล้ว
   ถ้ายอมรับ null ไว้เงียบๆ จะเหลือรูปที่ตามอะไรไม่ได้ ซึ่งทำลายเหตุผลทั้งหมด
   ของการอัปโหลดรูปทันทีที่ขั้นที่ 4 (§17 ข้อ 3) */
create or replace function public.pos_reserve_slip(
  p_slip_id     text,
  p_ticket_uid  text,
  p_table_label text,
  p_amount      numeric
) returns jsonb language plpgsql security definer set search_path = '' as
$$
declare
  v_dev   pos.devices := pos.require_device();
  v_id    text := nullif(btrim(coalesce(p_slip_id, '')), '');
  v_tk    text := nullif(btrim(coalesce(p_ticket_uid, '')), '');
  v_label text := left(nullif(btrim(coalesce(p_table_label, '')), ''), 40);
  v_name  text;
  v_today int;
begin
  if v_id is null or v_id !~ '^[A-Za-z0-9_-]{1,64}$' then
    raise exception 'รหัสรูปสลิปใช้ได้แค่ A-Z a-z 0-9 _ - และยาวไม่เกิน 64 ตัว'
      using errcode = 'POS06';
  end if;
  if v_tk is null or length(v_tk) > 64 or v_label is null then
    raise exception 'ใบจองรูปสลิปต้องมีรหัสใบสั่งและเลขโต๊ะ (เป็นร่องรอยเดียวถ้าใบสั่งหาย)'
      using errcode = 'POS06';
  end if;
  -- NaN/Infinity ของ JS กลายเป็น null ตอนแปลงเป็น JSON จึงถูกจับที่ is null ด้านบน/ล่าง
  -- ส่วน 'NaN'::numeric ที่ส่งมาเป็นสตริงจะไม่ผ่าน (NaN >= 0 จริง แต่ NaN < เพดาน เป็นเท็จ)
  if p_amount is null or not (p_amount >= 0 and p_amount < 10000000) then
    raise exception 'ใบจองรูปสลิปต้องมียอดเงินที่ถูกต้อง (ได้มา: %)', p_amount
      using errcode = 'POS06';
  end if;
  v_name := v_id || '.jpg';

  /* เพดานต่อวัน และต้องยกเว้นใบที่เป็นของเราเองอยู่แล้ว ไม่งั้นการลองจองซ้ำ
     (เน็ตหลุดตอนจอง) จะถูกปฏิเสธด้วยเหตุผลที่ไม่เกี่ยวกัน */
  select count(*)::int into v_today
    from pos.slips
   where device_uid = v_dev.uid and created_at > now() - make_interval(days => 1);
  if v_today >= pos.max_slips_per_day()
     and not exists (select 1 from pos.slips where slip_id = v_id) then
    raise exception 'เครื่องนี้จองรูปสลิปวันนี้ไปแล้ว % รูป ซึ่งเกินปกติมาก', v_today
      using errcode = 'POS07';
  end if;

  insert into pos.slips (slip_id, object_name, device_uid, ticket_uid, table_label, amount)
  values (v_id, v_name, v_dev.uid, v_tk, v_label, round(p_amount, 2))
  on conflict (slip_id) do nothing;

  /* จองซ้ำด้วยรหัสเดิมจากเครื่องอื่นต้องไม่ได้สิทธิ์อัปโหลดทับ
     ข้อความต้องเหมือนกับกรณีรหัสผิด เพื่อไม่ให้ใช้ผลต่างของข้อความไล่ถามว่า
     รหัสไหนมีอยู่จริง (ถ้ารู้ว่ารหัสไหนกำลังจะถูกใช้ ก็จองดักไว้ก่อนได้) */
  if not exists (select 1 from pos.slips
                  where slip_id = v_id and device_uid = v_dev.uid) then
    raise exception 'รหัสรูปสลิปใช้ไม่ได้ — ให้ถ่ายรูปใหม่' using errcode = 'POS08';
  end if;

  return jsonb_build_object('slipId', v_id, 'objectName', v_name, 'bucket', 'slips');
end
$$;

/* แจ้งว่าอัปโหลดแล้ว — **ตรวจเองว่าไฟล์อยู่ใน Storage จริง** ไม่เชื่อผู้เรียก
   เหตุผล: ถ้า response ของการอัปโหลดหายกลางทาง มือถือจะอ่าน bucket กลับมา
   เช็คเองไม่ได้ (นโยบายอ่านเป็นของเครื่องกลาง) จึงต้องเรียกตัวนี้ได้เสมอ
   หลังทุกความพยายามอัปโหลด รวมถึงตอนได้ 409 Duplicate แล้วให้เซิร์ฟเวอร์ตัดสิน
   ถ้าไม่ทำแบบนี้ ไฟล์จะอยู่ใน Storage แต่ทุก index บอกว่าไม่เคยอัปโหลด
   แล้ว pos.purge จะลบแถวเดียวที่บอกว่ารูปนั้นของโต๊ะไหนทิ้ง */
create or replace function public.pos_slip_uploaded(p_slip_id text)
  returns jsonb language plpgsql security definer set search_path = '' as
$$
declare
  v_dev pos.devices := pos.require_device();
  v_s   pos.slips;
  v_has boolean;
begin
  select * into v_s from pos.slips
   where slip_id = p_slip_id and device_uid = v_dev.uid;
  if not found then
    raise exception 'ไม่พบใบจองรูปสลิป % ของเครื่องนี้', p_slip_id using errcode = 'POS06';
  end if;

  select exists (
    select 1 from storage.objects o
     where o.bucket_id = 'slips' and o.name = v_s.object_name
  ) into v_has;

  if not v_has then
    return jsonb_build_object('uploaded', false,
      'reason', 'ยังไม่พบไฟล์รูปบนคลาวด์ — ให้ลองส่งอีกครั้ง');
  end if;

  update pos.slips set uploaded_at = coalesce(uploaded_at, now())
   where slip_id = v_s.slip_id;

  return jsonb_build_object('uploaded', true);
end
$$;

/* เครื่องกลางดูรายการรูปสลิป — รวมรูปที่ "ไม่มีใบสั่งคู่" ด้วย
   นี่คือสิ่งที่ทำให้คำสัญญาใน §17 ข้อ 3 เป็นจริง: ถ้าใบสั่งหายทั้งใบ
   (มือถือพัง / ไม่เคยกดส่ง) ยังต้องตามได้ว่ารับเงินโต๊ะไหนไปเท่าไร
   ถ้าไม่มีฟังก์ชันนี้ table_label กับ amount ที่ตั้งใจเก็บไว้จะไม่มีใครอ่านได้เลย */
create or replace function public.pos_slip_list(p_limit int default 100,
                                                p_orphans_only boolean default false)
  returns table (slip_id text, object_name text, ticket_uid text, ticket_state text,
                 table_label text, amount numeric, device_label text,
                 uploaded_ms bigint, created_ms bigint)
  language plpgsql stable security definer set search_path = '' as
$$
begin
  perform pos.require_device('central');
  return query
    select s.slip_id, s.object_name, s.ticket_uid, t.state, s.table_label, s.amount,
           d.label, pos.ms(s.uploaded_at), pos.ms(s.created_at)
      from pos.slips s
      join pos.devices d on d.uid = s.device_uid
      left join pos.tickets t on t.ticket_uid = s.ticket_uid
     where not coalesce(p_orphans_only, false) or t.ticket_uid is null
        or t.state in ('pending', 'review')
     order by s.created_at desc
     limit least(greatest(coalesce(p_limit, 100), 1), 500);
end
$$;

/* สองตัวนี้มีไว้ให้นโยบายของ Storage เรียก — ต้องเป็น security definer
   เพราะนิพจน์ในนโยบายทำงานด้วยสิทธิ์ของผู้เรียก ซึ่งอ่าน pos.slips ไม่ได้
   (RLS เปิดและไม่มี policy) ถ้าเขียนเป็น subquery ตรงๆ ในนโยบาย
   เงื่อนไขจะเป็นเท็จทุกครั้ง แล้วอัปโหลดจะไม่ผ่านเลยแบบหาสาเหตุไม่เจอ

   **ไม่เช็ค revoked_at โดยเจตนา** — ใบจองเองคือใบอนุญาตแล้ว และมันหมดอายุ
   ใน 48 ชม. ถ้าเช็คด้วย การถอนสิทธิ์มือถือที่หาย (งานประจำ ไม่ใช่อุบัติเหตุ)
   จะทำให้รูปสลิปที่จองไว้แต่ยังไม่ได้ส่งอัปโหลดไม่ได้อีกเลย = ทำลายหลักฐาน
   การรับเงินของลูกค้าหลายโต๊ะพร้อมกัน */
create or replace function public.pos_slip_upload_ok(p_name text)
  returns boolean language sql stable security definer set search_path = '' as
$$
  select exists (
    select 1
      from pos.slips s
     where s.object_name = p_name
       and s.device_uid = auth.uid()
       and s.uploaded_at is null
       and s.created_at > now() - make_interval(hours => pos.slip_reserve_hours())
  )
$$;

create or replace function public.pos_slip_read_ok()
  returns boolean language sql stable security definer set search_path = '' as
$$
  select exists (
    select 1 from pos.devices
     where uid = auth.uid() and role = 'central' and revoked_at is null
  )
$$;


-- ============================================================================
--  5. ที่เก็บรูปสลิป (Storage)
--
--  เพดาน **ขนาดไฟล์** บังคับที่ตัว bucket ซึ่งเป็นด่านที่ข้ามไม่ได้
--  ส่วน allowed_mime_types เทียบกับ Content-Type ที่ "ผู้ส่งประกาศมา" เท่านั้น
--  Supabase ไม่ได้ดมเนื้อไฟล์ ⇒ ของในนี้อาจเป็นไบต์อะไรก็ได้ที่ติดป้ายว่า jpeg
--  ฝั่งเครื่องกลางจึงต้องแสดงรูปด้วย <img> เท่านั้น ห้าม iframe/object
--  และเปิดผ่าน signed URL อายุสั้น (signed URL เป็นบัตรผ่านที่อยู่นอก RLS
--  ตลอดอายุของมัน ถอนสิทธิ์เครื่องแล้วลิงก์ที่ออกไปแล้วยังใช้ได้)
--  รูปที่แอปย่อแล้วไม่เกิน 180KB — ดู SLIP_MAX_BYTES ใน src/lib/slipPhoto.ts
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('slips', 'slips', false, 250000, array['image/jpeg'])
on conflict (id) do update
   set public = false,
       file_size_limit = 250000,
       allowed_mime_types = array['image/jpeg'];

drop policy if exists "pos_slips_insert"   on storage.objects;
drop policy if exists "pos_slips_readback" on storage.objects;
drop policy if exists "pos_slips_read"     on storage.objects;
drop policy if exists "pos_slips_delete"   on storage.objects;

-- อัปโหลดได้เฉพาะชื่อที่จองไว้แล้วโดยเครื่องตัวเอง และใบจองยังไม่หมดอายุ
create policy "pos_slips_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'slips' and public.pos_slip_upload_ok(name));

/* **ต้องมีนโยบาย select คู่กับ insert** — Storage อัปโหลดด้วย
   `insert into storage.objects … returning *` เพื่อคืน path/id ให้ผู้เรียก
   PostgreSQL บังคับนโยบาย select กับแถวที่ RETURNING คืนด้วย ถ้าไม่มี
   แถวถูก insert สำเร็จแต่คำสั่งทั้งคำสั่งล้มเป็น 403 ซึ่งหน้าตาเหมือน
   นโยบาย insert ผิด (เอกสาร Supabase ระบุอาการนี้ไว้ตรงๆ)
   ขอบเขตแคบ: เงื่อนไขเดียวกับการอัปโหลด = อ่านได้แต่ของตัวเองที่ยังไม่ส่งเสร็จ */
create policy "pos_slips_readback" on storage.objects
  for select to authenticated
  using (bucket_id = 'slips' and public.pos_slip_upload_ok(name));

-- **อ่านทั้งหมดได้เฉพาะเครื่องกลาง** มือถืออ่านของเครื่องอื่นไม่ได้ ถึงมือถือหาย
-- ก็ดูดรูปสลิปของลูกค้าทั้งร้านออกไปไม่ได้ (รูปสลิปมีเลขบัญชีและชื่อลูกค้าอยู่)
create policy "pos_slips_read" on storage.objects
  for select to authenticated
  using (bucket_id = 'slips' and public.pos_slip_read_ok());

-- ลบได้เฉพาะเครื่องกลาง (เพื่อเก็บกวาดไฟล์ขยะ) ไม่มีนโยบาย update เลย
-- มือถือจึงลบหรือเขียนทับรูปหลักฐานของตัวเองไม่ได้
create policy "pos_slips_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'slips' and public.pos_slip_read_ok());


-- ============================================================================
--  6. สิทธิ์ — **ต้องรันบล็อกนี้ซ้ำทุกครั้งที่ create or replace ฟังก์ชันใหม่**
--
--  Supabase ตั้ง default privileges ให้ฟังก์ชันใหม่ใน schema public ถูก grant
--  ให้ anon ด้วย ซึ่งรวมกับ security definer แล้วเท่ากับเปิดให้คนที่ยังไม่
--  ล็อกอินเรียกได้ จึงต้องถอนออกแล้วให้แค่ authenticated
--
--  **ใช้รายชื่อฟังก์ชันตรงๆ ไม่ใช่ like 'pos\_%'** — ถ้าวนตามชื่อแบบกว้าง
--  ฟังก์ชันที่ค้างจากไฟล์ติดตั้งรุ่นอื่นจะถูก grant ให้ authenticated ไปด้วย
--  (ไฟล์นี้ไม่ลบอะไรทิ้ง) ⇒ ของเก่าที่ควรตายกลับมีสิทธิ์อีกครั้งแบบเงียบๆ
-- ============================================================================

do $perm$
declare
  v_names text[] := array[
    'pos_whoami', 'pos_claim_enroll', 'pos_mint_phone_code', 'pos_list_devices',
    'pos_revoke_device', 'pos_heartbeat', 'pos_submit_ticket', 'pos_ticket_state',
    'pos_pending_tickets', 'pos_settle_ticket', 'pos_review_device_tickets',
    'pos_put_config', 'pos_get_config',
    'pos_reserve_slip', 'pos_slip_uploaded', 'pos_slip_list',
    'pos_slip_upload_ok', 'pos_slip_read_ok'
  ];
  f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = any(v_names)
  loop
    execute format('revoke all on function %s from public', f.sig);
    execute format('revoke all on function %s from anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end
$perm$;

-- ฟังก์ชันใน schema pos ไม่ให้ใครเรียกจากข้างนอกเลย (ใช้ผ่านหน้าเว็บ Supabase)
do $perm2$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'pos'
  loop
    execute format('revoke all on function %s from public', f.sig);
    execute format('revoke all on function %s from anon', f.sig);
    execute format('revoke all on function %s from authenticated', f.sig);
  end loop;
end
$perm2$;


-- ============================================================================
--  7. ตรวจตัวเอง — **ล้มทั้งไฟล์ถ้าไม่ครบ**
--
--  ฉบับก่อนใช้ raise notice ซึ่งไม่โผล่ใน SQL Editor ของ Supabase เลย
--  เจ้าของร้านจะเห็นแต่ "Success" แล้วคิดว่าติดตั้งครบ ทั้งที่ไม่ครบ
--
--  **ทุกการต่อ array ใช้ array_append** ไม่ใช่ `v_missing || 'ข้อความ'` —
--  text[] || <ลิเทอรัลที่ยังไม่มีชนิด> ถูกตีความเป็น array_cat แล้วพยายามแปลง
--  ลิเทอรัลเป็น text[] ⇒ ได้ error "malformed array literal" แทนข้อความไทย
--  ซึ่งทำให้บล็อกที่มีหน้าที่ฟ้องให้ชัด กลายเป็นบล็อกที่ฟ้องไม่รู้เรื่อง
-- ============================================================================

do $check$
declare
  v_missing text[] := '{}';
  v_fns     text[] := array[
    'pos_whoami', 'pos_claim_enroll', 'pos_mint_phone_code', 'pos_list_devices',
    'pos_revoke_device', 'pos_heartbeat', 'pos_submit_ticket', 'pos_ticket_state',
    'pos_pending_tickets', 'pos_settle_ticket', 'pos_review_device_tickets',
    'pos_put_config', 'pos_get_config',
    'pos_reserve_slip', 'pos_slip_uploaded', 'pos_slip_list',
    'pos_slip_upload_ok', 'pos_slip_read_ok'
  ];
  v_fn      text;
  v_tb      text;
  v_extra   int;
begin
  foreach v_tb in array array['devices', 'enroll_codes', 'tickets', 'slips', 'config'] loop
    if to_regclass('pos.' || v_tb) is null then
      v_missing := array_append(v_missing, 'ตาราง pos.' || v_tb);
    elsif not (select relrowsecurity from pg_class where oid = to_regclass('pos.' || v_tb)) then
      v_missing := array_append(v_missing, 'RLS ของ pos.' || v_tb);
    end if;
  end loop;

  foreach v_fn in array v_fns loop
    if not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = v_fn
    ) then
      v_missing := array_append(v_missing, 'ฟังก์ชัน public.' || v_fn);
    end if;
  end loop;

  /* ต้องไม่มีฟังก์ชัน public.pos_* เกินจากรายชื่อนี้
     ฟังก์ชันที่ค้างจากไฟล์ติดตั้งรุ่นอื่นคือทางเข้าที่ยังเปิดอยู่ */
  select count(*)::int into v_extra
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'pos\_%' and p.proname <> all(v_fns);
  if v_extra > 0 then
    v_missing := array_append(v_missing,
      'มีฟังก์ชัน public.pos_* เกินมา ' || v_extra || ' ตัว (ของค้างจากไฟล์ติดตั้งรุ่นอื่น ต้องลบก่อน)');
  end if;

  /* ตรวจดัชนีกันเครื่องกลางซ้ำจาก **นิยาม** ไม่ใช่แค่ชื่อ
     create unique index if not exists เป็น no-op ถ้ามีชื่อเดียวกันอยู่แล้ว
     ดัชนีเก่าที่เงื่อนไขไม่เหมือนกันจะผ่านการตรวจแบบดูชื่อไปเฉยๆ
     แล้วข้อบังคับที่สำคัญที่สุดของไฟล์นี้จะไม่ได้ถูกบังคับจริง */
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'pos' and tablename = 'devices'
       and indexname = 'devices_single_central'
       and indexdef like '%UNIQUE%'
       and indexdef like '%role = ''central''%'
       and indexdef like '%revoked_at IS NULL%'
  ) then
    v_missing := array_append(v_missing,
      'ดัชนีกันเครื่องกลางซ้ำ devices_single_central (ถ้ามีชื่อนี้อยู่แล้วแต่เงื่อนไขต่าง ต้อง drop index pos.devices_single_central ก่อน)');
  end if;

  if not exists (select 1 from storage.buckets where id = 'slips') then
    v_missing := array_append(v_missing, 'ที่เก็บรูป slips');
  end if;

  foreach v_fn in array array['pos_slips_insert', 'pos_slips_readback',
                              'pos_slips_read', 'pos_slips_delete'] loop
    if not exists (select 1 from pg_policies
                    where schemaname = 'storage' and tablename = 'objects'
                      and policyname = v_fn) then
      v_missing := array_append(v_missing, 'นโยบาย Storage ' || v_fn);
    end if;
  end loop;

  -- สิทธิ์: anon ต้องเรียกฟังก์ชันของเราไม่ได้แม้แต่ตัวเดียว
  if exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = any(v_fns)
       and has_function_privilege('anon', p.oid, 'execute')
  ) then
    v_missing := array_append(v_missing, 'การถอนสิทธิ์ anon (บล็อกที่ 6 ไม่ทำงาน)');
  end if;

  -- และ authenticated ต้องเรียกได้ครบทุกตัว ไม่งั้นแอปจะ 403 แบบหาสาเหตุไม่เจอ
  if exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = any(v_fns)
       and not has_function_privilege('authenticated', p.oid, 'execute')
  ) then
    v_missing := array_append(v_missing, 'การให้สิทธิ์ authenticated (บล็อกที่ 6 ไม่ทำงาน)');
  end if;

  -- และห้ามมีใครแตะตารางใน pos ได้ตรงๆ
  foreach v_tb in array array['devices', 'enroll_codes', 'tickets', 'slips', 'config'] loop
    if to_regclass('pos.' || v_tb) is not null
       and (has_table_privilege('anon', to_regclass('pos.' || v_tb)::oid, 'select')
            or has_table_privilege('authenticated', to_regclass('pos.' || v_tb)::oid, 'select')) then
      v_missing := array_append(v_missing, 'สิทธิ์อ่านตรงๆ ที่ pos.' || v_tb || ' ต้องถูกถอน');
    end if;
  end loop;

  if array_length(v_missing, 1) > 0 then
    raise exception E'ติดตั้งไม่ครบ ขาด: %\nไฟล์นี้ไม่ได้ติดตั้งอะไรเลย (ย้อนกลับหมดแล้ว) — ให้คัดลอกข้อความนี้ไปถาม',
      array_to_string(v_missing, ', ');
  end if;
end
$check$;


-- ============================================================================
--  8. ผลลัพธ์ — SQL Editor โชว์ตารางนี้ (โชว์ raise notice ไม่ได้)
-- ============================================================================

select 'ติดตั้งสำเร็จ'                                        as "ผล",
       (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname like 'pos\_%') as "ฟังก์ชันที่เปิดให้แอปเรียก",
       (select count(*) from pos.devices where revoked_at is null) as "เครื่องที่ผูกแล้ว",
       'ขั้นต่อไป: select pos.new_enroll_code(''central'');'   as "ทำต่อ";
