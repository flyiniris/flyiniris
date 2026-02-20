#!/usr/bin/env python3
"""
Flyin' Iris — Page Generator

Generates a couple's film delivery page from a template and config JSON.
Replaces {{TOKEN}} placeholders with actual values and writes the output
to films/{slug}/index.html.

Usage:
    python generate.py --config couple.json --template couple-page.html
    python generate.py --config couple.json --template couple-page.html --preview
"""

import argparse
import json
import os
import re
import shutil
import sys
import webbrowser


def load_config(path):
    """Load and return the couple config JSON from the given path."""
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        print(f"Error: Config file not found: {path}", file=sys.stderr)
        sys.exit(1)
    except json.JSONDecodeError as e:
        print(f"Error: Invalid JSON in config file: {e}", file=sys.stderr)
        sys.exit(1)


def validate_config(config):
    """Validate the couple config and return a list of error messages."""
    errors = []

    # slug
    if "slug" not in config:
        errors.append("Missing required field: 'slug'")
    elif not isinstance(config["slug"], str) or not config["slug"]:
        errors.append("'slug' must be a non-empty string")
    elif not re.match(r"^[a-z0-9-]+$", config["slug"]):
        errors.append("'slug' must contain only lowercase letters, numbers, and hyphens")

    # names
    if "names" not in config:
        errors.append("Missing required field: 'names'")
    elif not isinstance(config["names"], list) or len(config["names"]) != 2:
        errors.append("'names' must be a list of exactly 2 strings")
    elif not all(isinstance(n, str) and n for n in config["names"]):
        errors.append("Each name in 'names' must be a non-empty string")

    # date
    if "date" not in config:
        errors.append("Missing required field: 'date'")
    elif not isinstance(config["date"], str) or not config["date"]:
        errors.append("'date' must be a non-empty string (e.g., 'August 31, 2025')")

    # date_short
    if "date_short" not in config:
        errors.append("Missing required field: 'date_short'")
    elif not isinstance(config["date_short"], str) or not config["date_short"]:
        errors.append("'date_short' must be a non-empty string (e.g., '08.31.2025')")

    # videos
    if "videos" not in config:
        errors.append("Missing required field: 'videos'")
    elif not isinstance(config["videos"], list) or len(config["videos"]) == 0:
        errors.append("'videos' must be a non-empty list")
    else:
        required_video_fields = ["id", "title", "category", "duration", "order"]
        for i, video in enumerate(config["videos"]):
            if not isinstance(video, dict):
                errors.append(f"videos[{i}] must be an object")
                continue
            for field in required_video_fields:
                if field not in video:
                    errors.append(f"videos[{i}] missing required field: '{field}'")

    return errors


def extract_year(config):
    """Extract the 4-digit year from the date fields."""
    # Try long-form date first: "August 31, 2025"
    match = re.search(r"\b(\d{4})\b", config.get("date", ""))
    if match:
        return match.group(1)

    # Fallback to date_short: "08.31.2025" or "08/31/2025"
    match = re.search(r"\b(\d{4})\b", config.get("date_short", ""))
    if match:
        return match.group(1)

    return ""


def build_tokens(config, worker_base):
    """Build the token replacement dictionary from config and args."""
    return {
        "{{COUPLE_NAMES}}": " & ".join(config["names"]),
        "{{NAME_1}}": config["names"][0],
        "{{NAME_2}}": config["names"][1],
        "{{DATE_LONG}}": config["date"],
        "{{DATE_SHORT}}": config["date_short"],
        "{{SLUG}}": config["slug"],
        "{{WORKER_BASE}}": worker_base,
        "{{VIDEOS_JSON}}": json.dumps(config["videos"]),
        "{{YEAR}}": extract_year(config),
    }


def replace_tokens(content, tokens):
    """Replace all {{TOKEN}} placeholders in the content string."""
    for token, value in tokens.items():
        content = content.replace(token, value)
    return content


def read_file(path, description="file"):
    """Read and return the contents of a file."""
    try:
        with open(path, "r", encoding="utf-8") as f:
            return f.read()
    except FileNotFoundError:
        print(f"Error: {description} not found: {path}", file=sys.stderr)
        sys.exit(1)
    except OSError as e:
        print(f"Error reading {description}: {e}", file=sys.stderr)
        sys.exit(1)


def write_file(path, content, description="file"):
    """Write content to a file, creating parent directories as needed."""
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)
    except OSError as e:
        print(f"Error writing {description}: {e}", file=sys.stderr)
        sys.exit(1)


def main():
    parser = argparse.ArgumentParser(
        description="Generate a couple's film delivery page from a template and config JSON."
    )
    parser.add_argument(
        "--config", required=True,
        help="Path to the couple config JSON file"
    )
    parser.add_argument(
        "--template", required=True,
        help="Path to the couple-page.html template"
    )
    parser.add_argument(
        "--manifest",
        help="Path to the manifest.json template (optional)"
    )
    parser.add_argument(
        "--sw",
        help="Path to sw.js service worker file (optional)"
    )
    parser.add_argument(
        "--output-dir", default="films",
        help="Output directory for generated pages (default: films)"
    )
    parser.add_argument(
        "--worker-base", default="https://video.flyiniris.com",
        help="Base URL for the video Worker (default: https://video.flyiniris.com)"
    )
    parser.add_argument(
        "--preview", action="store_true",
        help="Open the generated page in the default browser"
    )

    args = parser.parse_args()

    # Load and validate config
    config = load_config(args.config)
    errors = validate_config(config)
    if errors:
        print("Config validation failed:", file=sys.stderr)
        for error in errors:
            print(f"  - {error}", file=sys.stderr)
        sys.exit(1)

    # Build token replacements
    tokens = build_tokens(config, args.worker_base)
    slug = config["slug"]
    couple_names = " & ".join(config["names"])
    out_dir = os.path.join(args.output_dir, slug)

    # Process template → index.html
    template_content = read_file(args.template, "template")
    html_content = replace_tokens(template_content, tokens)
    index_path = os.path.join(out_dir, "index.html")
    write_file(index_path, html_content, "index.html")
    print(f"  Wrote {index_path}")

    # Process manifest.json (if provided)
    if args.manifest:
        manifest_content = read_file(args.manifest, "manifest template")
        manifest_output = replace_tokens(manifest_content, tokens)
        manifest_path = os.path.join(out_dir, "manifest.json")
        write_file(manifest_path, manifest_output, "manifest.json")
        print(f"  Wrote {manifest_path}")

    # Copy sw.js (if provided)
    if args.sw:
        sw_dest = os.path.join(out_dir, "sw.js")
        try:
            os.makedirs(out_dir, exist_ok=True)
            shutil.copy2(args.sw, sw_dest)
            print(f"  Wrote {sw_dest}")
        except FileNotFoundError:
            print(f"Error: Service worker not found: {args.sw}", file=sys.stderr)
            sys.exit(1)
        except OSError as e:
            print(f"Error copying service worker: {e}", file=sys.stderr)
            sys.exit(1)

    # Summary
    print(f"\nGenerated page for {couple_names} at {os.path.join(args.output_dir, slug, 'index.html')}")

    # Preview in browser
    if args.preview:
        abs_path = os.path.abspath(index_path)
        url = "file:///" + abs_path.replace("\\", "/")
        print(f"  Opening in browser: {url}")
        webbrowser.open(url)


if __name__ == "__main__":
    main()
