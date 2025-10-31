rm -f Package/color.txt
g++ -o Package/mine.exe mine.cpp -std=c++23 -O3 -ffast-math -lstdc++exp
powershell Compress-Archive ./Package ./Package.zip -Force