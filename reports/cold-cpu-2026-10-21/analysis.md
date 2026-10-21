# Cold start và CPU — sáu framework Bun

Đo ngày 21/10/2026 (giờ Việt Nam).

## Phương pháp

- Cold start = từ ngay trước spawn đến khi đọc xong response HTTP hợp lệ đầu tiên; bao gồm import, khởi động framework, TCP, JIT route đầu và handler. GET và POST được đo trên hai tiến trình độc lập, không health check/warm-up trước đó. Mỗi framework/method có 10 lượt, tổng 120 lượt.
- Probe lặp mỗi 5ms khi bị từ chối kết nối; timeout/handler error làm trial thất bại. NODE_ENV=production. Không xóa OS/filesystem cache hoặc Bun transpiler cache; AOT được build trước và không tính build time. Đây là process-cold, không phải OS-cache-cold.
- CPU: 100 kết nối, 10 giây/method/vòng, 3 vòng, warm-up 2 giây/method. Mỗi framework/vòng có tiến trình mới; thứ tự framework xoay và GET/POST đổi giữa các vòng. CPU = Δ(user+system CPU time)/Δmonotonic wall time × 100, lấy ps TIME của PID server, độ phân giải CPU time 10ms trên macOS.
- CPU trung vị = trung vị các CPU trung vị từng vòng; CPU mean = trung vị các trung bình có trọng số thời gian từng vòng. CPU peak = max tất cả khoảng đầy đủ của cả ba vòng; kèm trung vị peak từng vòng trong dữ liệu. Khoảng đầy đủ dài tối thiểu 80% của 300ms; khoảng cuối ngắn vẫn được tính vào mean nhưng không tạo peak giả. Cửa sổ đo CPU bao trùm vòng đời oha, kể cả khởi tạo/drain, không gồm startup/warm-up server.
- CPU µs/request = tổng CPU time đã đo của server / số request, lấy trung vị ba vòng. CPU mean chia theo toàn bộ cửa sổ lấy mẫu, còn throughput do oha đo trên thời gian load, nên không lấy mean/req/s để tính lại chỉ số này.
- M2 Pro 10 CPU logic / 16 GiB; Bun 1.4.4-canary.1+5f5799ed1; oha 1.11.0. Client/server cùng máy, ứng dụng nền giữ nguyên. min–max là khoảng quan sát, không phải khoảng tin cậy. Không suy rộng kết quả hai route sang database hoặc hệ thống thực tế.

## Nhận định

- Cold GET: AOT 41.66 ms so với Elysia thường 59.84 ms, giảm 30.4% theo trung vị 10 tiến trình mới mỗi trường hợp.
- Cold POST: AOT 36.31 ms so với Elysia thường 57.82 ms, giảm 37.2% theo trung vị 10 tiến trình mới mỗi trường hợp.
- Native Bun khởi động đến response đầu nhanh nhất ở cả GET và POST. NestJS/Fastify có thời gian khởi động lớn hơn rõ trong ứng dụng hai route này; kết quả chưa phản ánh ứng dụng nghiệp vụ lớn.
- GET: CPU trung vị khoảng 65.2–71.5%; CPU peak lấy mẫu của các framework khoảng 78.2–91.9% một lõi. CPU peak của mỗi framework là max qua cả 3 vòng.
- POST: CPU trung vị khoảng 64.8–74.7%; CPU peak lấy mẫu của các framework khoảng 78.2–93.7% một lõi. CPU peak của mỗi framework là max qua cả 3 vòng.
- NestJS/Fastify dùng khoảng 73 µs CPU/request ở GET và 85 µs ở POST; nhóm còn lại khoảng 56–57 µs GET và 62–65 µs POST. AOT và Elysia thường có CPU time/request gần nhau, chưa thấy lợi CPU dưới tải rõ trong lần chạy này.
- Tải HTTP không giới hạn req/s: CPU thấp hơn có thể đi kèm throughput thấp hơn. CPU µs/request trong bảng dùng chênh lệch CPU time server chia số request để hỗ trợ so sánh; không phải wall latency/request.
- Peak CPU là trung bình của khoảng lấy mẫu ~300ms, không phải đỉnh tức thời. 100% tương đương một lõi; số liệu chỉ gồm PID server, không gồm oha hoặc ứng dụng khác. Máy có tải nền cao, nên đây là quan sát của lần chạy này.

## Kết quả cold start

### GET

- **Native Bun**: trung vị **21.06 ms**; min–max 18.11–31.11 ms; riêng request thành công đầu tiên: 2.61 ms trung vị.
- **Elysia 2 RC AOT**: trung vị **41.66 ms**; min–max 31.83–70.82 ms; riêng request thành công đầu tiên: 9.91 ms trung vị.
- **Dunx**: trung vị **57.00 ms**; min–max 46.38–81.71 ms; riêng request thành công đầu tiên: 3.01 ms trung vị.
- **Carno**: trung vị **59.27 ms**; min–max 53.58–89.67 ms; riêng request thành công đầu tiên: 3.27 ms trung vị.
- **Elysia 2 RC**: trung vị **59.84 ms**; min–max 51.43–98.61 ms; riêng request thành công đầu tiên: 6.62 ms trung vị.
- **NestJS/Fastify (Bun)**: trung vị **405.10 ms**; min–max 343.32–1000.21 ms; riêng request thành công đầu tiên: 14.78 ms trung vị.

### POST

- **Native Bun**: trung vị **19.46 ms**; min–max 18.35–46.53 ms; riêng request thành công đầu tiên: 3.13 ms trung vị.
- **Elysia 2 RC AOT**: trung vị **36.31 ms**; min–max 30.42–52.25 ms; riêng request thành công đầu tiên: 7.34 ms trung vị.
- **Dunx**: trung vị **50.60 ms**; min–max 46.13–77.20 ms; riêng request thành công đầu tiên: 3.98 ms trung vị.
- **Elysia 2 RC**: trung vị **57.82 ms**; min–max 54.97–91.46 ms; riêng request thành công đầu tiên: 12.99 ms trung vị.
- **Carno**: trung vị **68.58 ms**; min–max 50.41–120.50 ms; riêng request thành công đầu tiên: 4.42 ms trung vị.
- **NestJS/Fastify (Bun)**: trung vị **395.73 ms**; min–max 340.61–551.32 ms; riêng request thành công đầu tiên: 21.60 ms trung vị.

## CPU dưới tải HTTP

### GET

- **NestJS/Fastify (Bun)**: CPU trung vị **71.1%**, mean 65.6%, peak **91.9%** (trung vị peak từng vòng 81.3%); 9,760 req/s; **73.1 µs CPU/request**.
- **Elysia 2 RC**: CPU trung vị **70.7%**, mean 66.0%, peak **81.4%** (trung vị peak từng vòng 78.1%); 12,332 req/s; **55.7 µs CPU/request**.
- **Elysia 2 RC AOT**: CPU trung vị **71.1%**, mean 64.7%, peak **78.3%** (trung vị peak từng vòng 78.2%); 11,938 req/s; **56.6 µs CPU/request**.
- **Dunx**: CPU trung vị **65.2%**, mean 59.9%, peak **78.4%** (trung vị peak từng vòng 78.2%); 10,930 req/s; **56.4 µs CPU/request**.
- **Carno**: CPU trung vị **71.5%**, mean 67.2%, peak **78.3%** (trung vị peak từng vòng 78.3%); 12,122 req/s; **56.9 µs CPU/request**.
- **Native Bun**: CPU trung vị **69.5%**, mean 65.4%, peak **78.2%** (trung vị peak từng vòng 75.0%); 11,782 req/s; **55.7 µs CPU/request**.

### POST

- **NestJS/Fastify (Bun)**: CPU trung vị **71.5%**, mean 68.9%, peak **93.7%** (trung vị peak từng vòng 90.5%); 8,436 req/s; **84.7 µs CPU/request**.
- **Elysia 2 RC**: CPU trung vị **68.0%**, mean 65.1%, peak **92.3%** (trung vị peak từng vòng 78.2%); 10,708 req/s; **63.7 µs CPU/request**.
- **Elysia 2 RC AOT**: CPU trung vị **71.4%**, mean 67.2%, peak **81.6%** (trung vị peak từng vòng 78.4%); 11,030 req/s; **64.2 µs CPU/request**.
- **Dunx**: CPU trung vị **71.5%**, mean 69.1%, peak **81.7%** (trung vị peak từng vòng 81.4%); 11,478 req/s; **62.2 µs CPU/request**.
- **Carno**: CPU trung vị **74.7%**, mean 70.3%, peak **78.3%** (trung vị peak từng vòng 78.2%); 11,703 req/s; **63.2 µs CPU/request**.
- **Native Bun**: CPU trung vị **64.8%**, mean 60.6%, peak **78.2%** (trung vị peak từng vòng 71.3%); 9,484 req/s; **64.6 µs CPU/request**.

## Chạy lại

```sh
bun run bench -f nestjs-fastify,elysia,elysia-aot,dunx,carno,native-bun \
  --cold-starts 10 -z 10s -c 100 -r 3 --sample-interval 300ms
```

[Biểu đồ tương tác](report.html) · [Dữ liệu gốc](data.json) · [Hướng dẫn](../../BENCHMARKS.md)

120 cold trials và 36 lượt tải đều thành công; 3,977,798 request đo dưới tải trả 2xx, không có lỗi transport. CPU hiện dùng phương pháp delta CPU time, khác với số ps %cpu trong báo cáo trước.

## Kiểm tra

- 10 test / 40 assertion và kiểm tra TypeScript cho runner, CLI, CPU metrics đều qua.
- Đã tính lại độc lập cold median, CPU median/mean/peak, tổng hợp ba vòng và CPU/request từ toàn bộ dữ liệu gốc; khớp báo cáo.
- Chế độ `--cold-only` chạy được, bỏ qua tải HTTP và dọn tiến trình.
- HTML hiển thị đủ sáu framework cho cả GET/POST và sáu chỉ số; mã Canvas biên dịch được.
