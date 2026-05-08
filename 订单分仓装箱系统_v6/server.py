"""
订单分仓装箱系统 - Flask 后端
支持：文件上传运算、结果下载、按时间戳存档
"""
import os, sys, json, shutil, argparse, traceback

# 通过环境变量要求子进程使用 UTF-8，不直接操作 sys.stdout
os.environ.setdefault('PYTHONIOENCODING', 'utf-8')
os.environ.setdefault('PYTHONUTF8', '1')

from datetime import datetime
from flask import Flask, request, jsonify, send_file, send_from_directory

sys.path.insert(0, os.path.dirname(__file__))
from allocator import compute_allocation, pack_all_warehouses
from excel_io import read_input_template, write_output_report, create_input_template

app = Flask(__name__, static_folder='static')

BASE_DIR    = os.path.dirname(os.path.abspath(__file__))
ARCHIVE_DIR = os.path.join(BASE_DIR, 'archives')
TEMP_DIR    = os.path.join(BASE_DIR, 'temp')
os.makedirs(ARCHIVE_DIR, exist_ok=True)
os.makedirs(TEMP_DIR, exist_ok=True)


def now_ts():
    return datetime.now().strftime('%Y%m%d_%H%M%S')


# ── 页面 ──────────────────────────────────────
@app.route('/')
def index():
    return send_from_directory('static', 'index.html')


# ── 下载空白模板 ───────────────────────────────
@app.route('/api/template')
def download_template():
    path = os.path.join(TEMP_DIR, '输入模板.xlsx')
    create_input_template(path)
    return send_file(path, as_attachment=True,
                     download_name='输入模板（请填写此文件）.xlsx')


# ── 主运算接口 ────────────────────────────────
@app.route('/api/run', methods=['POST'])
def run_allocation():
    if 'file' not in request.files:
        return jsonify({'error': '请上传输入文件'}), 400

    f = request.files['file']
    if not f.filename.endswith('.xlsx'):
        return jsonify({'error': '请上传 .xlsx 格式文件'}), 400

    batch_ts  = now_ts()
    batch_dir = os.path.join(ARCHIVE_DIR, batch_ts)
    os.makedirs(batch_dir, exist_ok=True)

    input_path  = os.path.join(batch_dir, f'输入数据_{batch_ts}.xlsx')
    output_path = os.path.join(batch_dir, f'输出报告_{batch_ts}.xlsx')

    try:
        f.save(input_path)

        # 读取输入
        try:
            sku_volumes, sku_names, order_totals, target_ratios, stocks = \
                read_input_template(input_path)
        except Exception as e:
            raise ValueError(f'读取文件失败：{e}，请检查格式是否与模板一致')

        if not order_totals:
            raise ValueError('「订单数量」Sheet 没有有效数据，请检查填写')
        if not sku_volumes:
            raise ValueError('「SKU信息」Sheet 没有有效数据，请检查填写')

        # 分仓计算
        alloc_results, alloc_warnings = compute_allocation(
            order_totals, target_ratios, stocks)

        if not alloc_results:
            raise ValueError('分仓计算结果为空，请检查目标比例配置是否与订单SKU匹配')

        # 装箱优化
        containers, pack_warnings = pack_all_warehouses(alloc_results, sku_volumes)
        all_warnings = alloc_warnings + pack_warnings

        # 写出报告
        write_output_report(output_path, alloc_results, containers, all_warnings, sku_names)

        # 保存元数据
        meta = {
            'batch_ts':        batch_ts,
            'input_file':      os.path.basename(input_path),
            'output_file':     os.path.basename(output_path),
            'sku_count':       len(sku_volumes),
            'order_sku_count': len(order_totals),
            'total_allocated': sum(r.allocated_qty for r in alloc_results),
            'container_count': len(containers),
            'avg_utilization': round(
                sum(c.utilization for c in containers) / len(containers) * 100, 1
            ) if containers else 0,
            'low_util_count':  sum(1 for c in containers if c.is_low_utilization),
            'warning_count':   len(all_warnings),
            'warehouses':      sorted(set(
                r.warehouse for r in alloc_results if r.allocated_qty > 0)),
            'container_summary': [
                {
                    'id':          c.container_id,
                    'warehouse':   c.warehouse,
                    'utilization': round(c.utilization * 100, 1),
                    'used_vol':    round(c.used_volume, 3),
                    'sku_count':   c.sku_count,
                    'is_low':      c.is_low_utilization,
                }
                for c in containers
            ],
            'warnings': all_warnings,
        }
        with open(os.path.join(batch_dir, 'meta.json'), 'w', encoding='utf-8') as fp:
            json.dump(meta, fp, ensure_ascii=False, indent=2)

        return jsonify({'batch_ts': batch_ts, 'summary': meta})

    except ValueError as e:
        # 已知的用户输入错误：清理目录，返回友好提示
        shutil.rmtree(batch_dir, ignore_errors=True)
        return jsonify({'error': str(e)}), 400

    except Exception as e:
        # 未预期错误：保留目录方便排查，记录堆栈
        err_log = os.path.join(batch_dir, 'error.log')
        with open(err_log, 'w', encoding='utf-8') as fp:
            fp.write(traceback.format_exc())
        try:
            print(f'[ERROR] batch {batch_ts} failed, see error.log')
        except (UnicodeEncodeError, ValueError):
            pass
        return jsonify({
            'error': f'系统内部错误：{e}',
            'detail': '请查看控制台或 archives/{batch_ts}/error.log 获取详情'
        }), 500


# ── 下载输出报告 ──────────────────────────────
@app.route('/api/download/<batch_ts>')
def download_report(batch_ts):
    batch_dir = os.path.join(ARCHIVE_DIR, batch_ts)
    fname = f'输出报告_{batch_ts}.xlsx'
    path  = os.path.join(batch_dir, fname)
    if not os.path.exists(path):
        return jsonify({'error': '文件不存在'}), 404
    return send_file(path, as_attachment=True, download_name=fname)


# ── 下载输入存档 ──────────────────────────────
@app.route('/api/download-input/<batch_ts>')
def download_input(batch_ts):
    batch_dir = os.path.join(ARCHIVE_DIR, batch_ts)
    fname = f'输入数据_{batch_ts}.xlsx'
    path  = os.path.join(batch_dir, fname)
    if not os.path.exists(path):
        return jsonify({'error': '文件不存在'}), 404
    return send_file(path, as_attachment=True, download_name=fname)


# ── 批次历史列表 ──────────────────────────────
@app.route('/api/history')
def history():
    batches = []
    if os.path.isdir(ARCHIVE_DIR):
        for name in sorted(os.listdir(ARCHIVE_DIR), reverse=True):
            meta_path = os.path.join(ARCHIVE_DIR, name, 'meta.json')
            if os.path.exists(meta_path):
                try:
                    with open(meta_path, encoding='utf-8') as fp:
                        batches.append(json.load(fp))
                except Exception:
                    pass  # 跳过损坏的元数据文件
    return jsonify(batches)


# ── 删除批次 ──────────────────────────────────
@app.route('/api/history/<batch_ts>', methods=['DELETE'])
def delete_batch(batch_ts):
    # 安全校验：只允许删除符合时间戳格式的目录，防止路径穿越
    import re
    if not re.fullmatch(r'\d{8}_\d{6}', batch_ts):
        return jsonify({'error': '无效的批次ID'}), 400
    batch_dir = os.path.join(ARCHIVE_DIR, batch_ts)
    if os.path.isdir(batch_dir):
        shutil.rmtree(batch_dir)
        return jsonify({'ok': True})
    return jsonify({'error': '批次不存在'}), 404


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=5050)
    parser.add_argument('--open', action='store_true', help='Open browser when server is ready')
    args = parser.parse_args()

    # 安全 print：编码失败时用 replace 而非崩溃，完全不动 sys.stdout 对象
    def safe_print(msg):
        try:
            print(msg)
        except (UnicodeEncodeError, ValueError):
            print(msg.encode('ascii', errors='replace').decode('ascii'))

    # 若指定 --open，在独立线程里等服务器就绪后打开浏览器
    if args.open:
        import threading, urllib.request, webbrowser, time

        def _open_browser():
            url = f'http://localhost:{args.port}'
            for _ in range(20):
                time.sleep(1)
                try:
                    urllib.request.urlopen(url + '/api/history', timeout=1)
                    webbrowser.open(url)
                    return
                except Exception:
                    pass
            webbrowser.open(url)

        threading.Thread(target=_open_browser, daemon=True).start()

    safe_print(f'[OK] Server starting on http://localhost:{args.port}')
    safe_print(f'     Archives: {ARCHIVE_DIR}')
    safe_print(f'     Stop: Ctrl+C')
    app.run(host='0.0.0.0', port=args.port, debug=False)
