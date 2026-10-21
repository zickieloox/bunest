# So sánh Elysia 2 RC và các framework Bun

Đo ngày 21/10/2026 (giờ Việt Nam).

## Cấu hình

100 kết nối; 10 giây/method/vòng; warm-up 2 giây/method; 3 vòng. Mỗi framework/vòng chạy tiến trình mới với NODE_ENV=production, xoay thứ tự framework và đổi thứ tự GET/POST giữa các vòng. GET / trả JSON; POST /echo parse JSON 64 byte và trả msg, echo, timestamp. Các route được chọn không có schema validation. Build AOT bằng plugin chính thức với strip:true, dùng chung source với Elysia thường; thời gian build nằm ngoài phép đo.

Tất cả 36 lượt đo trả 2xx, không có lỗi transport. Response được kiểm tra tương đương trước khi đo. Tổng số request đo thành công: 4,030,871.

## Nhận định

- GET: Native Bun có trung vị cao nhất, 12,691 req/s; khoảng ba vòng 11,951–12,849 req/s.
- POST: Dunx có trung vị cao nhất, 11,347 req/s; khoảng ba vòng 11,312–11,737 req/s.
- AOT so với Elysia thường: GET: throughput +0.9%; RSS peak trung vị 38.0 so với 44.4 MiB (14.5% thấp hơn). POST: throughput +3.4%; RSS peak trung vị 39.5 so với 43.9 MiB (10.1% thấp hơn).
- Khoảng min–max throughput của AOT và Elysia thường chồng lấn ở cả GET và POST; ba vòng trên máy đang có tải nền chưa đủ để kết luận AOT nhanh hơn ổn định. Không đo cold start nên không suy ra lợi ích thời gian khởi động.
- NestJS/Fastify dùng khoảng 101–102 MiB RSS peak trung vị. Đây là chi phí của cấu hình NestJS/Fastify trong hai route đơn giản; bài này chưa đo lợi ích DI, module hoặc nghiệp vụ thực tế.
- Máy M2 Pro 10 CPU logic / 16 GiB, Bun 1.4.4-canary.1+5f5799ed1, oha 1.11.0. Load average quan sát khoảng 9–10, Chrome và ứng dụng nền dùng nhiều CPU. Client và server chung máy; không coi đây là trần hiệu năng hoặc bảng xếp hạng tổng quát của framework.

## Số liệu

Req/s và p50/p95/p99 là trung vị của ba vòng; p99 không phải percentile gộp. Khoảng req/s là min–max ba vòng. RSS là trung vị của peak được lấy mẫu mỗi 300ms; GET và POST dùng chung tiến trình trong một vòng. ps %cpu là trung bình theo hệ điều hành, không dùng để xếp hạng CPU.

### GET

- **Native Bun**: 12,691 req/s (11,951–12,849); p50/p95/p99 7.35/11.06/16.62 ms; RSS peak 32.2 MiB.
- **Dunx**: 12,356 req/s (12,193–12,741); p50/p95/p99 7.52/12.33/18.77 ms; RSS peak 39.0 MiB.
- **Elysia 2 RC AOT**: 12,254 req/s (12,008–12,549); p50/p95/p99 7.47/12.04/17.48 ms; RSS peak 38.0 MiB.
- **Elysia 2 RC**: 12,142 req/s (10,634–12,270); p50/p95/p99 7.59/12.76/17.45 ms; RSS peak 44.4 MiB.
- **Carno**: 11,828 req/s (9,598–12,599); p50/p95/p99 7.60/13.54/20.17 ms; RSS peak 37.8 MiB.
- **NestJS + Fastify (Bun)**: 9,927 req/s (9,747–10,944); p50/p95/p99 8.94/15.69/25.19 ms; RSS peak 101.1 MiB.

### POST

- **Dunx**: 11,347 req/s (11,312–11,737); p50/p95/p99 8.07/13.01/18.49 ms; RSS peak 40.7 MiB.
- **Native Bun**: 11,233 req/s (10,291–11,688); p50/p95/p99 8.13/13.20/21.35 ms; RSS peak 36.8 MiB.
- **Carno**: 11,218 req/s (10,617–11,257); p50/p95/p99 8.17/13.41/20.60 ms; RSS peak 39.4 MiB.
- **Elysia 2 RC AOT**: 10,767 req/s (10,011–11,116); p50/p95/p99 8.39/14.81/22.57 ms; RSS peak 39.5 MiB.
- **Elysia 2 RC**: 10,409 req/s (10,008–11,059); p50/p95/p99 8.73/15.12/22.40 ms; RSS peak 43.9 MiB.
- **NestJS + Fastify (Bun)**: 8,853 req/s (8,297–9,940); p50/p95/p99 10.17/18.22/28.95 ms; RSS peak 102.1 MiB.

## Chạy lại

```sh
bun install --frozen-lockfile
bun run bench -f nestjs-fastify,elysia,elysia-aot,dunx,carno,native-bun -z 10s -c 100 -r 3
```

[Dữ liệu gốc và metadata](data.json) · [Biểu đồ tương tác](report.html) · [Hướng dẫn CLI](../../BENCHMARKS.md) · [AOT chính thức](https://next.elysiajs.com/patterns/aot/)

Để xác nhận chênh lệch nhỏ, cần đo lại trên máy rảnh và/hoặc tách máy phát tải, tăng số vòng. Bài hai route này không đo database, business logic, cold start hoặc hiệu năng toàn hệ thống.

## Kiểm tra triển khai

- `bun run bench:test`: 6 test, 21 assertion, đều qua.
- Kiểm tra TypeScript cho runner, CLI, test và Elysia source/build: qua.
- Smoke test GET/POST cả 12 biến thể framework: qua (kết quả smoke không đưa vào bảng so sánh chính).
- Cổng 3000 đã có server: runner từ chối và giữ nguyên tiến trình đang dùng cổng.
- Ngắt bằng SIGINT trong lúc phát tải: runner dừng server và oha do mình tạo, trả exit code 130 và giải phóng cổng.
- Kiểm tra báo cáo: đủ 36 JSON kết quả gốc; HTML hiển thị đủ 6 framework cho GET/POST và cả ba chỉ số.
