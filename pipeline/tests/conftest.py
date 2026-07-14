import pathlib
import sys

# Put pipeline/ on the path so tests can `import config`, `import tools`,
# `import server` exactly as the modules import each other.
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))