from __future__ import annotations

import struct
import zipfile
from dataclasses import dataclass
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MODELS_DIR = ROOT / "public" / "models"
OUTPUT_PATH = MODELS_DIR / "resilient_four.usdz"


@dataclass(frozen=True)
class MascotLayer:
    display_name: str
    package_name: str
    layer_name: str
    prim_name: str
    translate_x: float
    stand_rotation_x: float = -90
    face_rotation_y: float = -90


MASCOT_LAYERS = (
    MascotLayer("Solido", "mascot_solido.usdz", "mascot_solido.usdc", "Solido", -0.9),
    MascotLayer("Amihan", "mascot_amihan.usdz", "mascot_amihan.usdc", "Amihan", -0.3),
    MascotLayer("Ulan", "mascot_ulan.usdz", "mascot_ulan.usdc", "Ulan", 0.3),
    MascotLayer("Apoy", "mascot_apoy.usdz", "mascot_apoy.usdc", "Apoy", 0.9),
)


def main() -> None:
    package_entries: dict[str, bytes] = {
        "resilient_four.usda": create_root_layer().encode("utf-8")
    }

    for mascot in MASCOT_LAYERS:
        source_package = MODELS_DIR / mascot.package_name
        if not source_package.exists():
            raise FileNotFoundError(f"Missing source USDZ: {source_package}")

        with zipfile.ZipFile(source_package, "r") as source:
            root_layer_name = find_root_layer(source)
            package_entries[mascot.layer_name] = source.read(root_layer_name)

            for source_name in source.namelist():
                if source_name == root_layer_name:
                    continue
                if source_name.endswith("/"):
                    continue

                data = source.read(source_name)
                previous = package_entries.get(source_name)
                if previous is not None and previous != data:
                    raise ValueError(
                        f"Asset path conflict while combining USDZ files: {source_name}"
                    )
                package_entries[source_name] = data

    write_aligned_usdz(OUTPUT_PATH, package_entries)
    validate_usdz(OUTPUT_PATH)
    print(f"Wrote {OUTPUT_PATH.relative_to(ROOT)}")


def create_root_layer() -> str:
    mascot_prims = "\n\n".join(create_mascot_prim(mascot) for mascot in MASCOT_LAYERS)

    return f"""#usda 1.0
(
    defaultPrim = "ResilientFour"
    metersPerUnit = 1
    upAxis = "Y"
)

def Xform "ResilientFour" (
    kind = "component"
)
{{
{mascot_prims}
}}
"""


def create_mascot_prim(mascot: MascotLayer) -> str:
    return f"""    def Xform "{mascot.prim_name}"
    {{
        double3 xformOp:translate = ({mascot.translate_x}, 0, 0)
        uniform token[] xformOpOrder = ["xformOp:translate"]

        def Xform "Model" (
            prepend references = @{mascot.layer_name}@
        )
        {{
            float xformOp:rotateX:stand = {mascot.stand_rotation_x}
            float xformOp:rotateY:face = {mascot.face_rotation_y}
            uniform token[] xformOpOrder = ["xformOp:rotateX:stand", "xformOp:rotateY:face"]
        }}
    }}"""


def find_root_layer(package: zipfile.ZipFile) -> str:
    for name in package.namelist():
        if name.lower().endswith((".usda", ".usdc", ".usd")):
            return name

    raise ValueError("USDZ package does not contain a USD root layer.")


def write_aligned_usdz(output_path: Path, entries: dict[str, bytes]) -> None:
    ordered_entries = [
        ("resilient_four.usda", entries["resilient_four.usda"]),
        *(
            (name, data)
            for name, data in sorted(entries.items())
            if name != "resilient_four.usda"
        ),
    ]

    with zipfile.ZipFile(output_path, "w") as package:
        for name, data in ordered_entries:
            info = zipfile.ZipInfo(name)
            info.compress_type = zipfile.ZIP_STORED
            info.create_system = 3
            info.date_time = (2026, 7, 2, 0, 0, 0)
            info.extra = create_alignment_extra(package.fp.tell(), name)
            package.writestr(info, data)


def create_alignment_extra(header_offset: int, name: str) -> bytes:
    base_data_offset = header_offset + 30 + len(name.encode("utf-8"))
    extra_size = (64 - (base_data_offset % 64)) % 64

    if extra_size == 0:
        return b""

    if extra_size < 4:
        extra_size += 64

    payload_size = extra_size - 4
    return struct.pack("<HH", 0xFFFF, payload_size) + bytes(payload_size)


def validate_usdz(path: Path) -> None:
    with zipfile.ZipFile(path, "r") as package:
        infos = package.infolist()
        if not infos:
            raise ValueError("USDZ package is empty.")
        if infos[0].filename != "resilient_four.usda":
            raise ValueError("The first USDZ file must be the root USD layer.")

        for info in infos:
            if info.compress_type != zipfile.ZIP_STORED:
                raise ValueError(f"{info.filename} is compressed.")

            local_data_offset = info.header_offset + 30 + len(info.filename.encode("utf-8")) + len(
                info.extra
            )
            if local_data_offset % 64 != 0:
                raise ValueError(f"{info.filename} is not 64-byte aligned.")


if __name__ == "__main__":
    main()
