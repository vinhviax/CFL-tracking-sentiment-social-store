# AGENT.md

Quy tac lam viec cho moi agent tiep tuc project **CFL Feedback Intelligence**.

## Thu tu doc bat buoc

1. Doc `AGENT.md` de nam rule lam viec.
2. Doc `MEMORY.md` de nam kien truc, endpoint, deploy, secret, data model.
3. Doc file moi nhat trong `handoff/` de nam tien do va viec can lam tiep.
4. Chi sau do moi doc code hoac chay lenh.

## Nguyen tac voi user

- Giao tiep bang tieng Viet.
- Chu dong lam den noi den chon, khong dung o muc phan tich neu co the tu thuc hien.
- Neu co quyet dinh co rui ro cao hoac anh huong chi phi/du lieu/secret/deploy, phai noi ro trade-off truoc khi lam.
- Khong tu nhap, log, commit, hay paste API key/token/secret. Huong dan user tu chay `wrangler secret put <NAME>`.
- Neu thay secret da lo trong chat/log/file, canh bao user rotate/regenerate ngay.
- Khong xoa/revert thay doi cua user neu khong duoc yeu cau ro.
- Khi sua code, uu tien TDD: viet test fail truoc, sua code, chay test lai.
- Truoc khi bao hoan thanh, phai chay verify that: test/build/typecheck/API/deploy tuy theo viec vua lam.

## Quy tac tai lieu

Project chi duoc giu cac file Markdown sau:

- `AGENT.md`: rule lam viec cua agent.
- `MEMORY.md`: thong tin project, kien truc, secrets, deploy, trang thai song.
- `handoff/*.md`: ban giao tien do theo phien lam viec.

Khong them README/BRIEF/docs Markdown khac neu user chua yeu cau. Neu can ghi nho thong tin, cap nhat vao 3 nhom tren.

## Git va deploy

- Repo GitHub: `https://github.com/vinhviax/CFL-tracking-sentiment-social-store.git`
- Branch lam viec hien tai: `main`
- Khi user yeu cau push/deploy:
  - Chay test/build lien quan truoc.
  - Commit ro noi dung.
  - Push branch len origin.
  - Deploy Worker bang `cd worker && npx wrangler deploy`.
  - Deploy Pages bang `cd frontend && npm run build && npx wrangler pages deploy ./dist --project-name=cfl-feedback`.
  - Verify production endpoints sau deploy.

## Coding standards

- Worker: TypeScript + Hono + Cloudflare D1.
- Frontend: React + Vite.
- D1 co gioi han bound parameters thap, query `IN (...)` phai chunk khoang 90 item.
- Cloudflare Workers co gioi han subrequest, ingest Facebook/Sensor Tower phai gioi han page/range hop ly.
- `xlsx` phai giu dependency tu `https://cdn.sheetjs.com/xlsx-latest/xlsx-latest.tgz`, khong cai `xlsx` thuong tu npm registry.
- CSV Facebook Group co the la UTF-16 LE + tab-delimited; parser phai auto-detect.
- Cron Cloudflare chay UTC. Danh sach cron hien tai xem trong `MEMORY.md` (muc Cloudflare config).

## Local workspace

Thu muc lam viec chinh tu sau phien 2026-07-06:

`J:\My Drive\CFL\Agent\Tracking Store Social`

Thu muc cu:

`G:\CFM\Research\Crossfire Legends Sea`

Neu mo project o may khac, uu tien clone/pull tai thu muc chinh moi.
