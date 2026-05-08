"""
订单分仓 + 集装箱装箱优化核心逻辑
"""
from dataclasses import dataclass, field
from typing import Dict, List, Tuple
from collections import defaultdict


# ─────────────────────────────────────────────
# 数据结构
# ─────────────────────────────────────────────

@dataclass
class SKUInfo:
    sku_id: str
    volume_m3: float          # 单件体积

@dataclass
class WarehouseStock:
    sku_id: str
    warehouse: str
    on_hand: int              # 在库数量
    in_transit: int           # 在途数量
    transit_eta: str          # 预计到货日期（字符串，仅展示用）

@dataclass
class AllocationResult:
    sku_id: str
    warehouse: str
    order_qty: int            # 本次总订单量
    already_qty: int          # 在库+在途
    target_ratio: float       # 目标比例
    target_qty: int           # 理想目标总量
    allocated_qty: int        # 本次分配量
    final_ratio: float        # 分配后实际比例

@dataclass
class Container:
    container_id: str
    warehouse: str
    capacity_m3: float = 66.0
    items: List[Tuple[str, int, float]] = field(default_factory=list)  # (sku_id, qty, vol)
    _used_volume: float = field(default=0.0, init=False, repr=False)   # 缓存，随 add() 累加

    @property
    def used_volume(self) -> float:
        return self._used_volume

    @property
    def utilization(self) -> float:
        return self._used_volume / self.capacity_m3

    @property
    def sku_count(self) -> int:
        return len(set(s for s, _, _ in self.items))

    @property
    def is_low_utilization(self) -> bool:
        return self.utilization < 0.98

    def can_add(self, sku_id: str, qty: int, unit_vol: float, max_skus: int = 18) -> bool:
        new_vol = self._used_volume + qty * unit_vol
        existing_skus = set(s for s, _, _ in self.items)
        new_sku_count = len(existing_skus | {sku_id})
        return new_vol <= self.capacity_m3 and new_sku_count <= max_skus

    def add(self, sku_id: str, qty: int, unit_vol: float):
        total_vol = qty * unit_vol
        self.items.append((sku_id, qty, total_vol))
        self._used_volume += total_vol


# ─────────────────────────────────────────────
# 模块一：分仓计算
# ─────────────────────────────────────────────

def compute_allocation(
    order_totals: Dict[str, int],                  # {sku_id: 总订单量}
    target_ratios: Dict[str, Dict[str, float]],    # {sku_id: {warehouse: ratio}}
    stocks: List[WarehouseStock],                  # 在库+在途数据
) -> Tuple[List[AllocationResult], List[str]]:
    """
    计算每个 SKU 在每个仓库的本次分配数量。
    逻辑：
      already = on_hand + in_transit
      total_already = sum(already across warehouses)
      total_after = total_already + order_qty
      target_qty[wh] = round(target_ratio[wh] * total_after)
      allocated[wh] = max(0, target_qty[wh] - already[wh])
      如果分配总和 != order_qty，将差额按比例补给分配量最大的仓库
    """
    warnings = []
    results = []

    # 整理 stock 数据
    stock_map: Dict[str, Dict[str, WarehouseStock]] = defaultdict(dict)
    for s in stocks:
        stock_map[s.sku_id][s.warehouse] = s

    for sku_id, order_qty in order_totals.items():
        if sku_id not in target_ratios:
            warnings.append(f"SKU {sku_id} 没有目标比例配置，跳过分仓")
            continue

        ratios = target_ratios[sku_id]
        warehouses = list(ratios.keys())

        # 计算各仓已有量
        already: Dict[str, int] = {}
        eta_map: Dict[str, str] = {}
        for wh in warehouses:
            s = stock_map.get(sku_id, {}).get(wh)
            if s:
                already[wh] = s.on_hand + s.in_transit
                eta_map[wh] = s.transit_eta
            else:
                already[wh] = 0
                eta_map[wh] = ""

        total_already = sum(already.values())

        # 验证比例之和
        ratio_sum = sum(ratios.values())
        if abs(ratio_sum - 1.0) > 0.01:
            warnings.append(f"SKU {sku_id} 目标比例之和={ratio_sum:.3f}，不等于1，已自动归一化")
            ratios = {wh: v / ratio_sum for wh, v in ratios.items()}

        total_after = total_already + order_qty

        # 计算目标量（取整）
        target_qty: Dict[str, int] = {}
        for wh in warehouses:
            target_qty[wh] = round(ratios[wh] * total_after)

        # 计算应分配量（不能为负）
        raw_alloc: Dict[str, int] = {}
        for wh in warehouses:
            diff = target_qty[wh] - already[wh]
            if diff < 0:
                warnings.append(f"SKU {sku_id} 仓库 {wh}: 已有量({already[wh]})超过目标量({target_qty[wh]})，本次分配设为0")
                raw_alloc[wh] = 0
            else:
                raw_alloc[wh] = diff

        # 调整使总分配量等于订单量
        alloc_sum = sum(raw_alloc.values())
        diff = order_qty - alloc_sum

        if diff != 0:
            # 将差额分配给目前分配量最大且比例最大的仓库
            sorted_wh = sorted(warehouses, key=lambda w: (raw_alloc[w], ratios[w]), reverse=True)
            # 逐件分配余量（正或负）
            step = 1 if diff > 0 else -1
            for _ in range(abs(diff)):
                for wh in sorted_wh:
                    if raw_alloc[wh] + step >= 0:
                        raw_alloc[wh] += step
                        break

        # 构建结果
        final_total = total_already + order_qty
        for wh in warehouses:
            final_count = already[wh] + raw_alloc[wh]
            final_ratio = final_count / final_total if final_total > 0 else 0
            results.append(AllocationResult(
                sku_id=sku_id,
                warehouse=wh,
                order_qty=order_qty,
                already_qty=already[wh],
                target_ratio=ratios[wh],
                target_qty=target_qty[wh],
                allocated_qty=raw_alloc[wh],
                final_ratio=final_ratio,
            ))

    return results, warnings


# ─────────────────────────────────────────────
# 模块二：装箱优化（全局只允许1个低利用率箱）
# ─────────────────────────────────────────────

MAX_SKUS_PER_CONTAINER = 18
CONTAINER_CAPACITY = 66.0
MIN_UTILIZATION = 0.98
MIN_FILL = CONTAINER_CAPACITY * MIN_UTILIZATION  # 64.68 m³


def _bfd_pack(
    wh_sku_allocs: Dict[str, Dict[str, int]],  # {warehouse: {sku_id: qty}}
    sku_volumes: Dict[str, float],
    cid_start: int = 1,
) -> Tuple[List[Container], List[str]]:
    """
    对单个仓库执行 Best-Fit Decreasing 装箱，不做跨仓合并。
    返回该仓库所有集装箱（可能含多个低利用率箱）。
    """
    warnings = []
    all_containers: List[Container] = []
    cid = cid_start

    for warehouse in sorted(wh_sku_allocs.keys()):
        items = {k: v for k, v in wh_sku_allocs[warehouse].items() if v > 0}
        if not items:
            continue

        # FFD：按单件体积降序
        sku_list = sorted(items.keys(), key=lambda s: sku_volumes.get(s, 0), reverse=True)
        remaining = dict(items)
        containers: List[Container] = []

        for sku_id in sku_list:
            unit_vol = sku_volumes.get(sku_id, 0)
            if unit_vol <= 0:
                warnings.append(f"SKU {sku_id} 体积缺失，跳过")
                continue
            if unit_vol > CONTAINER_CAPACITY:
                warnings.append(f"SKU {sku_id} 单件体积({unit_vol:.4f}m³)超过集装箱，跳过")
                continue

            qty_left = remaining[sku_id]
            while qty_left > 0:
                # Best Fit：剩余空间最小且能放下的箱
                best_box = None
                best_space = float('inf')
                for c in containers:
                    space = c.capacity_m3 - c.used_volume
                    if space >= unit_vol and c.can_add(sku_id, 1, unit_vol):
                        if space < best_space:
                            best_space = space
                            best_box = c
                if best_box is None:
                    best_box = Container(container_id=f"C{cid:03d}", warehouse=warehouse)
                    cid += 1
                    containers.append(best_box)

                space_left = best_box.capacity_m3 - best_box.used_volume
                put = min(qty_left, int(space_left / unit_vol))
                if put <= 0:
                    best_box = Container(container_id=f"C{cid:03d}", warehouse=warehouse)
                    cid += 1
                    containers.append(best_box)
                    put = min(qty_left, int(best_box.capacity_m3 / unit_vol))
                best_box.add(sku_id, put, unit_vol)
                qty_left -= put

        all_containers.extend(containers)

    return all_containers, warnings, cid


def _extract_loose(containers: List[Container]) -> Dict[str, Dict[str, Tuple[int, float]]]:
    """
    从低利用率箱中提取散货。
    返回 {warehouse: {sku_id: (qty, unit_vol)}}
    """
    loose: Dict[str, Dict[str, Tuple[int, float]]] = defaultdict(dict)
    for box in containers:
        if not box.is_low_utilization:
            continue
        for sku_id, qty, vol in box.items:
            unit_vol = vol / qty if qty > 0 else 0
            wh = box.warehouse
            if sku_id in loose[wh]:
                loose[wh][sku_id] = (loose[wh][sku_id][0] + qty, unit_vol)
            else:
                loose[wh][sku_id] = (qty, unit_vol)
    return loose


def _fill_into_normal_boxes(
    normal_boxes: List[Container],
    loose: Dict[str, Dict[str, Tuple[int, float]]],
) -> Dict[str, Dict[str, Tuple[int, float]]]:
    """
    把散货尽量塞入【同仓库】满箱的剩余空间。
    严禁跨仓填缝：A仓的货绝不能放进B仓的箱子。
    返回仍未放下的散货。
    """
    remaining_loose: Dict[str, Dict[str, Tuple[int, float]]] = defaultdict(dict)

    for wh, sku_map in loose.items():
        # 只找同仓库的满箱
        same_wh_boxes = [b for b in normal_boxes if b.warehouse == wh]
        same_wh_boxes.sort(key=lambda b: b.used_volume, reverse=True)

        # 按单件体积升序（小件先填缝）
        sorted_skus = sorted(sku_map.items(), key=lambda x: x[1][1])
        for sku_id, (qty, unit_vol) in sorted_skus:
            qty_left = qty
            for box in same_wh_boxes:
                if qty_left <= 0:
                    break
                space = box.capacity_m3 - box.used_volume
                if space >= unit_vol and box.can_add(sku_id, 1, unit_vol):
                    put = min(qty_left, int(space / unit_vol))
                    if put > 0:
                        box.add(sku_id, put, unit_vol)
                        qty_left -= put
            if qty_left > 0:
                remaining_loose[wh][sku_id] = (qty_left, unit_vol)

    return remaining_loose


def _repack_loose_to_one_box(
    remaining_loose: Dict[str, Dict[str, Tuple[int, float]]],
    cid_next: int,
) -> Tuple[List[Container], List[str], int]:
    """
    将各仓散货重新装箱。
    核心原则：每箱货物必须属于同一仓库，绝不混装。

    策略：
    1. 每个仓库的散货先单独紧密装箱（BFD）
    2. 若所有仓库散货总体积 ≤ 66m³，尝试体积最大的仓库"收容"其他仓库散货
       → 但这会改变分仓比例，因此只在体积差异极小时（<1件）才做
    3. 其他情况：各仓库各自装箱，最终仍可能有多个低利用率箱
       → 上层调用者判断是否超出约束并发出警告
    """
    warnings = []
    if not remaining_loose:
        return [], warnings, cid_next

    new_boxes: List[Container] = []

    for wh, sku_map in remaining_loose.items():
        items = [(s, q, uv) for s, (q, uv) in sku_map.items() if q > 0]
        if not items:
            continue
        items.sort(key=lambda x: x[2], reverse=True)  # 大件优先

        qty_left_map = {s: q for s, q, _ in items}
        vol_map      = {s: uv for s, q, uv in items}

        for sku_id, qty_total, unit_vol in items:
            qty_left = qty_left_map[sku_id]
            while qty_left > 0:
                # Best Fit，仅在同仓库新箱中选
                best_box = None
                best_space = float('inf')
                for b in new_boxes:
                    if b.warehouse != wh:
                        continue
                    space = b.capacity_m3 - b.used_volume
                    if space >= unit_vol and b.can_add(sku_id, 1, unit_vol):
                        if space < best_space:
                            best_space = space
                            best_box = b
                if best_box is None:
                    best_box = Container(
                        container_id=f"C{cid_next:03d}", warehouse=wh
                    )
                    cid_next += 1
                    new_boxes.append(best_box)

                space_left = best_box.capacity_m3 - best_box.used_volume
                put = min(qty_left, int(space_left / unit_vol))
                if put <= 0:
                    best_box = Container(
                        container_id=f"C{cid_next:03d}", warehouse=wh
                    )
                    cid_next += 1
                    new_boxes.append(best_box)
                    put = min(qty_left, int(best_box.capacity_m3 / unit_vol))
                best_box.add(sku_id, put, unit_vol)
                qty_left -= put
            qty_left_map[sku_id] = 0

    low_new = [b for b in new_boxes if b.is_low_utilization]
    if len(low_new) > 1:
        warnings.append(
            f"散货重新装箱后仍有 {len(low_new)} 个低利用率箱 "
            f"(涉及仓库: {', '.join(sorted({b.warehouse for b in low_new}))})，"
            f"散货总体积={sum(b.used_volume for b in new_boxes):.2f}m³"
        )

    return new_boxes, warnings, cid_next


def _renumber_containers(containers: List[Container]) -> List[Container]:
    """按仓库排序后重新编号"""
    sorted_ct = sorted(containers, key=lambda c: (c.warehouse, c.used_volume < MIN_FILL, -c.used_volume))
    for i, c in enumerate(sorted_ct, start=1):
        c.container_id = f"C{i:03d}"
    return sorted_ct


def pack_all_warehouses(
    allocation_results: List[AllocationResult],
    sku_volumes: Dict[str, float],
) -> Tuple[List[Container], List[str]]:
    """
    全局装箱主函数。硬性约束：全局最多只有1个低利用率集装箱。

    核心原则：一箱只发一仓，绝不混装不同仓库的货物。
    跨仓合并策略（贪心配对）：
      每轮找两个尾货仓，其尾货体积之和 ≤ 66m³，则把小者转移给大者合并为1个尾箱。
      若找不到可合并配对（所有组合 > 66m³），则把最小尾货转移给最大尾货仓，
      虽然还会产生2个箱（1满+1尾），但全局低利用率箱数量仍减少1个。
      重复直到全局只剩1个低利用率箱。
    """
    all_warnings: List[str] = []

    wh_sku: Dict[str, Dict[str, int]] = defaultdict(dict)
    for r in allocation_results:
        if r.allocated_qty > 0:
            wh_sku[r.warehouse][r.sku_id] = r.allocated_qty

    if not wh_sku:
        return [], all_warnings

    # current_alloc 跟踪实时分配量（含跨仓转移后的调整）
    current_alloc: Dict[str, Dict[str, int]] = {wh: dict(skus) for wh, skus in wh_sku.items()}

    # ── 阶段1：各仓库独立 BFD 装箱 ──
    containers, w1, cid = _bfd_pack(current_alloc, sku_volumes, cid_start=1)
    all_warnings.extend(w1)

    # ── 阶段2：同仓填缝 ──
    low_boxes  = [c for c in containers if c.is_low_utilization]
    norm_boxes = [c for c in containers if not c.is_low_utilization]
    if len(low_boxes) > 1:
        loose = _extract_loose(low_boxes)
        remaining = _fill_into_normal_boxes(norm_boxes, loose)
        new_tails, w2, cid = _repack_loose_to_one_box(remaining, cid)
        all_warnings.extend(w2)
        containers = norm_boxes + new_tails

    # ── 阶段3：跨仓尾货配对合并（迭代） ──
    for iteration in range(20):
        low_boxes = [c for c in containers if c.is_low_utilization]
        if len(low_boxes) <= 1:
            break

        # 收集各仓尾货：{wh: (尾箱体积, {sku_id: (qty, unit_vol)})}
        wh_tail: Dict[str, Tuple[float, Dict]] = {}
        for box in low_boxes:
            wh = box.warehouse
            items: Dict[str, Tuple[int, float]] = {}
            for sku_id, qty, vol in box.items:
                unit_vol = vol / qty if qty > 0 else 0
                items[sku_id] = (items.get(sku_id, (0, unit_vol))[0] + qty, unit_vol)
            # 若同一仓库有多个低利用率箱（极少见），合并
            if wh in wh_tail:
                prev_vol, prev_items = wh_tail[wh]
                for s, (q, uv) in items.items():
                    prev_q = prev_items.get(s, (0, uv))[0]
                    prev_items[s] = (prev_q + q, uv)
                wh_tail[wh] = (prev_vol + box.used_volume, prev_items)
            else:
                wh_tail[wh] = (box.used_volume, items)

        # 按尾货体积从小到大
        tail_list = sorted(wh_tail.items(), key=lambda x: x[1][0])
        donor_wh,   (donor_vol,   donor_items)   = tail_list[0]
        receiver_wh,(receiver_vol,receiver_items) = tail_list[-1]

        # 寻找最优接收仓（合并后 ≤ 66m³ 且利用率最高）
        best_recv = None
        best_combined = 0.0
        for wh, (vol, _) in tail_list[1:]:
            combined = vol + donor_vol
            if combined <= CONTAINER_CAPACITY and combined > best_combined:
                best_combined = combined
                best_recv = wh

        if best_recv is None:
            # 无法合并进1箱，转移给最大尾货仓（减少1个低利用率箱，但可能新增1满箱）
            best_recv = receiver_wh
            combined_vol = donor_vol + receiver_vol
            all_warnings.append(
                f"跨仓转移（迭代{iteration+1}）：{donor_wh}尾货({donor_vol:.2f}m³)"
                f"→{best_recv}，合并体积({combined_vol:.2f}m³)>{CONTAINER_CAPACITY}m³，"
                f"将产生1个新满箱+1个新尾箱，全局低利用率箱数减少1个。"
                f"注意：这会影响 {donor_wh} 的实际入库比例。"
            )
        else:
            all_warnings.append(
                f"跨仓转移（迭代{iteration+1}）：将 {donor_wh} 尾箱"
                f"({donor_vol:.2f}m³)并入 {best_recv} 尾箱({wh_tail[best_recv][0]:.2f}m³)，"
                f"合并后={best_combined:.2f}m³。"
                f"注意：这会影响 {donor_wh} 的实际入库比例。"
            )

        # 执行转移：donor的货物加入receiver的current_alloc
        recv_alloc = dict(current_alloc.get(best_recv, {}))
        for sku_id, (qty, _) in donor_items.items():
            recv_alloc[sku_id] = recv_alloc.get(sku_id, 0) + qty
        current_alloc[best_recv] = recv_alloc

        # donor仓减去被转移的货物
        donor_alloc = dict(current_alloc.get(donor_wh, {}))
        for sku_id, (qty, _) in donor_items.items():
            donor_alloc[sku_id] = donor_alloc.get(sku_id, 0) - qty
            if donor_alloc[sku_id] <= 0:
                donor_alloc.pop(sku_id, None)
        if donor_alloc:
            current_alloc[donor_wh] = donor_alloc
        else:
            current_alloc.pop(donor_wh, None)

        # 只重新装箱受影响的两个仓库
        other_boxes = [c for c in containers
                       if c.warehouse != donor_wh and c.warehouse != best_recv]

        repack_alloc = {}
        if best_recv in current_alloc:
            repack_alloc[best_recv] = current_alloc[best_recv]
        if donor_wh in current_alloc:
            repack_alloc[donor_wh] = current_alloc[donor_wh]

        if repack_alloc:
            new_boxes, w3, cid = _bfd_pack(repack_alloc, sku_volumes, cid_start=cid)
            all_warnings.extend(w3)
            # 同仓填缝
            low2 = [c for c in new_boxes if c.is_low_utilization]
            norm2 = [c for c in new_boxes if not c.is_low_utilization]
            if len(low2) > 1:
                loose2 = _extract_loose(low2)
                rem2 = _fill_into_normal_boxes(norm2, loose2)
                tails2, _, cid = _repack_loose_to_one_box(rem2, cid)
                new_boxes = norm2 + tails2
            containers = other_boxes + new_boxes
        else:
            containers = other_boxes

    # ── 阶段4：重新编号，最终验证 ──
    containers = _renumber_containers(containers)
    low_final = [c for c in containers if c.is_low_utilization]

    if len(low_final) == 0:
        all_warnings.append("✅ 全局无低利用率集装箱，所有箱利用率 ≥ 98%")
    elif len(low_final) == 1:
        lc = low_final[0]
        all_warnings.append(
            f"✅ 全局低利用率集装箱：1个（{lc.container_id}，"
            f"仓库={lc.warehouse}，利用率={lc.utilization:.1%}）—— 满足约束"
        )
    else:
        all_warnings.append(
            f"⚠️ 全局低利用率集装箱仍有 {len(low_final)} 个（超出约束）。"
            f"涉及仓库：{', '.join(sorted({c.warehouse for c in low_final}))}。"
            f"建议调整分仓比例或订单量。"
        )

    return containers, all_warnings
