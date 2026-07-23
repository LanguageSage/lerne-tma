import re

with open('c:\\121\\Lerne_projekt\\tma\\app\\src\\App.jsx', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Add imports at the top
import_str = """import { TUTORIAL_STEPS, DESIGN_PRESETS } from './constants/appConstants';
import { useSettingsStore } from './store/useSettingsStore';"""

content = content.replace("import { TutorialOverlay } from './components/TutorialOverlay';", 
                          "import { TutorialOverlay } from './components/TutorialOverlay';\n" + import_str)

# 2. Remove TUTORIAL_STEPS and DESIGN_PRESETS constants
# Find start of TUTORIAL_STEPS
tut_start = content.find("const TUTORIAL_STEPS = {")
# Find end of DESIGN_PRESETS
design_end = content.find("];\n\nfunction App() {")

if tut_start != -1 and design_end != -1:
    content = content[:tut_start] + content[design_end + 3:]

# 3. Replace state variables with Zustand store
state_vars_start = content.find("  const [autoPlay, setAutoPlay] = useState(() => {")
state_vars_end = content.find("  const [isSettingsOpen, setIsSettingsOpen] = useState(false);")

if state_vars_start != -1 and state_vars_end != -1:
    zustand_str = """  const {
    autoPlay, setAutoPlay,
    autoShow, setAutoShow,
    cardBgFront, setCardBgFront,
    cardBgBack, setCardBgBack,
    cardFont, setCardFont,
    cardTextColor, setCardTextColor,
    cardFontSize, setCardFontSize,
    contextFont, setContextFont,
    contextTextColor, setContextTextColor,
    contextFontSize, setContextFontSize,
    cardTextShadow, setCardTextShadow,
    contextTextShadow, setContextTextShadow,
    cardFontWeight, setCardFontWeight,
    cardFontStyle, setCardFontStyle,
    contextFontWeight, setContextFontWeight,
    contextFontStyle, setContextFontStyle,
    adminSettings, setAdminSettings,
    userPrompts, setUserPrompts,
    applyDesignPreset,
  } = useSettingsStore();

"""
    content = content[:state_vars_start] + zustand_str + content[state_vars_end:]

# 4. Remove the massive block of useEffects related to local storage
# The useEffects are after `useEffect(() => { if (isNewDeckModalOpen) ...`
use_effect_start = content.find("  useEffect(() => {\n    storage.set('lerne_autoplay', autoPlay);\n  }, [autoPlay]);")
use_effect_end = content.find("  useEffect(() => {\n    if (card?.audio_url) {")

if use_effect_start != -1 and use_effect_end != -1:
    content = content[:use_effect_start] + content[use_effect_end:]

# 5. Remove `adminSettings` and `userPrompts` useState (since they are now in Zustand)
# They are around line 243
content = re.sub(r"  const \[adminSettings, setAdminSettings\] = useState\(\{\}\);\n", "", content)
content = re.sub(r"  const \[userPrompts, setUserPrompts\] = useState\(\{ translation_prompt: '', context_prompt: '' \}\);\n", "", content)

# 6. Remove applyDesignPreset from App.jsx (since it's in Zustand now)
# Find applyDesignPreset function
apply_preset_regex = re.compile(r"  const applyDesignPreset = \(preset\) => \{.*?\};\n\n", re.DOTALL)
content = apply_preset_regex.sub("", content)

with open('c:\\121\\Lerne_projekt\\tma\\app\\src\\App.jsx', 'w', encoding='utf-8') as f:
    f.write(content)
print("Refactored App.jsx successfully.")
