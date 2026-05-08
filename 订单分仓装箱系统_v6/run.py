"""
订单分仓装箱系统 - 主程序入口
用法：
  python run.py                        # 使用默认路径
  python run.py --template             # 仅生成空白输入模板
  python run.py --input 输入.xlsx      # 指定输入文件
  python run.py --output 报告.xlsx     # 指定输出文件
"""
import sys
import os
import argparse

# 确保当前目录在路径中
sys.path.insert(0, os.path.dirname(__file__))

from allocator import compute_allocation, pack_all_warehouses
from excel_io import create_input_template, read_input_template, write_output_report


DEFAULT_INPUT  = "输入数据.xlsx"
DEFAULT_OUTPUT = "输出报告.xlsx"
TEMPLATE_PATH  = "输入模板（请填写此文件）.xlsx"


def main():
    parser = argparse.ArgumentParser(description="订单分仓装箱系统")
    parser.add_argument("--template", action="store_true", help="仅生成空白输入模板")
    parser.add_argument("--input",  default=DEFAULT_INPUT,  help=f"输入文件路径（默认：{DEFAULT_INPUT}）")
    parser.add_argument("--output", default=DEFAULT_OUTPUT, help=f"输出文件路径（默认：{DEFAULT_OUTPUT}）")
    args = parser.parse_args()

    # ── 仅生成模板 ──
    if args.template:
        create_input_template(TEMPLATE_PATH)
        print(f"\n✅ 模板已生成：{TEMPLATE_PATH}")
        print("请打开模板文件，填写数据后，运行：python run.py")
        return

    # ── 检查输入文件 ──
    if not os.path.exists(args.input):
        print(f"\n⚠️  未找到输入文件：{args.input}")
        print("正在为您生成空白模板...\n")
        create_input_template(TEMPLATE_PATH)
        print(f"✅ 模板已生成：{TEMPLATE_PATH}")
        print(f"请填写模板后，将文件重命名为「{DEFAULT_INPUT}」，再运行本程序。")
        return

    print(f"\n📂 读取输入文件：{args.input}")
    try:
        sku_volumes, sku_names, order_totals, target_ratios, stocks = read_input_template(args.input)
    except Exception as e:
        print(f"❌ 读取输入文件失败：{e}")
        print("请检查文件格式是否与模板一致。")
        return

    print(f"   SKU数量：{len(sku_volumes)}  |  订单SKU数：{len(order_totals)}  |  仓库库存记录：{len(stocks)}")

    # ── 模块一：分仓计算 ──
    print("\n🔄 计算分仓比例...")
    alloc_results, alloc_warnings = compute_allocation(
        order_totals=order_totals,
        target_ratios=target_ratios,
        stocks=stocks,
    )

    total_allocated = sum(r.allocated_qty for r in alloc_results)
    print(f"   分仓完成：共 {len(alloc_results)} 条分仓记录，总分配 {total_allocated:,} 件")

    if alloc_warnings:
        print(f"   ⚠️  分仓警告 {len(alloc_warnings)} 条")

    # ── 模块二：装箱优化 ──
    print("\n📦 执行装箱优化...")
    containers, pack_warnings = pack_all_warehouses(
        allocation_results=alloc_results,
        sku_volumes=sku_volumes,
    )

    all_warnings = alloc_warnings + pack_warnings
    low_util = [c for c in containers if c.is_low_utilization]
    avg_util = sum(c.utilization for c in containers) / len(containers) if containers else 0

    print(f"   装箱完成：共 {len(containers)} 个集装箱，平均利用率 {avg_util:.1%}")
    if low_util:
        print(f"   ⚠️  低利用率集装箱（<98%）：{len(low_util)} 个")
    if pack_warnings:
        print(f"   ⚠️  装箱警告 {len(pack_warnings)} 条")

    # ── 输出报告 ──
    print(f"\n📊 生成输出报告：{args.output}")
    write_output_report(
        filepath=args.output,
        allocation_results=alloc_results,
        containers=containers,
        warnings=all_warnings,
        sku_names=sku_names,
    )

    # ── 打印集装箱汇总 ──
    print("\n" + "="*55)
    print("  集装箱装箱汇总")
    print("="*55)
    print(f"  {'仓库':<15} {'箱数':>6} {'平均利用率':>10} {'低利用率箱':>10}")
    print("-"*55)

    from collections import defaultdict
    wh_ct = defaultdict(list)
    for c in containers:
        wh_ct[c.warehouse].append(c)

    for wh in sorted(wh_ct.keys()):
        cts = wh_ct[wh]
        avg = sum(c.utilization for c in cts) / len(cts)
        lows = sum(1 for c in cts if c.is_low_utilization)
        flag = " ⚠️" if lows > 0 else ""
        print(f"  {wh:<15} {len(cts):>6} {avg:>10.1%} {lows:>10}{flag}")

    print("-"*55)
    print(f"  {'合计':<15} {len(containers):>6} {avg_util:>10.1%} {len(low_util):>10}")
    print("="*55)

    if all_warnings:
        print(f"\n⚠️  共有 {len(all_warnings)} 条警告，详见报告「⚠️警告」Sheet")

    print(f"\n✅ 完成！报告已保存至：{args.output}\n")


if __name__ == "__main__":
    main()
