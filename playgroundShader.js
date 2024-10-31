
const playgroundSource = `
internal uniform float time;

// Return the current time in milliseconds
public float getTime()
{
    return time;
}

struct FormatedStruct
{
    uint32_t type = 0xFFFFFFFF;
    uint32_t low = 0;
    uint32_t high = 0;
};

internal RWStructuredBuffer<FormatedStruct> g_printedBuffer;

interface IPrintf
{
    uint32_t typeFlag();
    uint32_t writePrintfWords();
};

extension uint : IPrintf
{
    uint32_t typeFlag() { return 2;}
    uint32_t writePrintfWords() { return (uint32_t)this; }
}

extension int : IPrintf
{
    uint32_t typeFlag() { return 2;}
    uint32_t writePrintfWords() { return (uint32_t)this; }
}

// extension int64_t : IPrintf
// {
//     uint64_t writePrintfWords() { return (uint64_t)this; }
// }

// extension uint64_t : IPrintf
// {
//     uint64_t writePrintfWords() { return (uint64_t)this; }
// }

extension float : IPrintf
{
    uint32_t typeFlag() { return 2;}
    uint32_t writePrintfWords() { return bit_cast<uint32_t>(this); }
}

// extension double : IPrintf
// {
//     uint64_t writePrintfWords() { return bit_cast<uint64_t>(this); }
// }

extension String : IPrintf
{
    uint32_t typeFlag() { return 1;}
    uint32_t writePrintfWords() { return getStringHash(this); }
}

void handleEach<T>(T value, int index) where T :  IPrintf
{
    g_printedBuffer[index].type = value.typeFlag();
    g_printedBuffer[index].low = value.writePrintfWords();
}

public void print<each T>(String format, expand each T values) where T : IPrintf
{
    //if (format.length != 0)
    {
        g_printedBuffer[0].type = 1;
        g_printedBuffer[0].low = getStringHash(format);
        int index = 1;
        expand(handleEach(each values, index++));

        g_printedBuffer[index] = {};
    }
}
`;
